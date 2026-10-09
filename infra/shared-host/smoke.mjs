import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { chromium } from "@playwright/test";
import { SignJWT } from "jose";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const fixture = resolve(root, "infra/shared-host/site");
const databaseUrl = "postgres://postgres:proof@127.0.0.1:55432/postgres";
const proxyToken = "proof-only-proxy-token";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const { privateKey: otherPrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwtKey = publicKey.export({ type: "spki", format: "pem" });
const issuer = "https://fixture.clerk.accounts.dev";
let origin = "http://admin.test";

async function session(claims = {}) {
	return new SignJWT({ sid: "sess_fixture", azp: origin, ...claims })
		.setProtectedHeader({ alg: "RS256" })
		.setIssuer(claims.issuer ?? issuer)
		.setSubject(claims.subject ?? "user_fixture")
		.setIssuedAt()
		.setExpirationTime("5m")
		.sign(privateKey);
}
const containers = [];
let host;
let clerkFixture;

async function command(file, args, options = {}) {
	return (await exec(file, args, { cwd: root, ...options })).stdout.trim();
}

async function container(image, options, args = []) {
	const id = await command("docker", [
		"run",
		"-d",
		"--rm",
		"--network",
		"host",
		...options,
		image,
		...args,
	]);
	containers.push(id);
	return id;
}

async function waitFor(check) {
	for (let attempt = 0; attempt < 60; attempt++) {
		try {
			if (await check()) return;
		} catch {
			// The service may still be starting.
		}
		await delay(500);
	}
	throw new Error("Service did not become ready");
}

function request(hostname, path = "/", port = 18080, headers = {}, method = "GET") {
	return new Promise((resolveResponse, reject) => {
		const req = httpRequest(
			{ hostname: "127.0.0.1", port, path, method, headers: { Host: hostname, ...headers } },
			(res) => {
				const chunks = [];
				res.on("data", (chunk) => chunks.push(chunk));
				res.on("end", () =>
					resolveResponse({
						status: res.statusCode,
						headers: res.headers,
						text: () => Buffer.concat(chunks).toString(),
					}),
				);
			},
		);
		req.on("error", reject);
		req.end();
	});
}

try {
	const pg = await container(
		"postgres:18-alpine",
		["-e", "POSTGRES_PASSWORD=proof"],
		["postgres", "-c", "port=55432", "-c", "listen_addresses=127.0.0.1"],
	);
	await waitFor(async () =>
		(await command("docker", ["exec", pg, "pg_isready", "-p", "55432"])).includes(
			"accepting connections",
		),
	);
	await command("docker", [
		"exec",
		pg,
		"psql",
		"-p",
		"55432",
		"-U",
		"postgres",
		"-c",
		"CREATE TABLE proof_sites (name text PRIMARY KEY, greeting text NOT NULL); INSERT INTO proof_sites VALUES ('foo', 'Hello from Foo'), ('bar', 'Hello from Bar'); CREATE TABLE _emdash_sites (id text PRIMARY KEY, slug text UNIQUE NOT NULL, active integer NOT NULL DEFAULT 1); CREATE TABLE _emdash_site_hosts (hostname text PRIMARY KEY, site_id text NOT NULL REFERENCES _emdash_sites(id)); INSERT INTO _emdash_sites (id, slug) VALUES ('site-foo', 'foo'), ('site-bar', 'bar'); INSERT INTO _emdash_site_hosts VALUES ('foo.test', 'site-foo'), ('bar.test', 'site-bar'); CREATE TABLE ec_posts (id text PRIMARY KEY, site_id text NOT NULL REFERENCES _emdash_sites(id), slug text NOT NULL, locale text NOT NULL, status text NOT NULL, title text NOT NULL, UNIQUE(site_id, slug, locale)); INSERT INTO ec_posts VALUES ('foo-entry', 'site-foo', 'shared', 'en', 'published', 'Foo story'), ('bar-entry', 'site-bar', 'shared', 'en', 'published', 'Bar story'), ('foo-only', 'site-foo', 'exclusive', 'en', 'published', 'Only Foo')",
	]);

	let sessionActive = true;
	clerkFixture = createServer((req, res) => {
		const sessionId = req.url?.split("/")[3];
		res.setHeader("Content-Type", "application/json");
		if (sessionId === "sess_fixture" && req.method === "POST") {
			sessionActive = false;
			res.end(
				JSON.stringify({
					object: "session",
					id: sessionId,
					user_id: "user_fixture",
					status: "revoked",
				}),
			);
		} else if (sessionId === "sess_fixture") {
			res.end(
				JSON.stringify({
					object: "session",
					id: sessionId,
					user_id: "user_fixture",
					status: sessionActive ? "active" : "revoked",
				}),
			);
		} else if (sessionId === "sess_outage") {
			res.writeHead(503);
			res.end(
				JSON.stringify({ errors: [{ code: "service_unavailable", message: "Unavailable" }] }),
			);
		} else {
			res.writeHead(404);
			res.end(
				JSON.stringify({ errors: [{ code: "resource_not_found", message: "Unknown session" }] }),
			);
		}
	});
	await new Promise((ready) => clerkFixture.listen(0, "127.0.0.1", ready));

	for (let attempt = 0; attempt < 2; attempt++) {
		await command(process.execPath, [resolve(root, "infra/shared-host/provision.mjs")], {
			env: { ...process.env, DATABASE_URL: databaseUrl },
		});
	}

	for (const site of ["foo", "bar"]) {
		await command(resolve(root, "infra/shared-host/node_modules/.bin/astro"), ["build"], {
			cwd: fixture,
			env: { ...process.env, PROOF_SITE: site },
		});
	}
	await command(resolve(root, "infra/shared-host/node_modules/.bin/astro"), ["build"], {
		cwd: fixture,
		env: {
			...process.env,
			PROOF_SITE: "admin",
			PUBLIC_CLERK_SIGN_IN_URL: "https://fixture.accounts.dev/sign-in",
			DATABASE_URL: databaseUrl,
		},
	});

	host = spawn(process.execPath, [resolve(root, "infra/shared-host/host.mjs")], {
		cwd: root,
		env: {
			...process.env,
			PROOF_PORT: "18081",
			PROOF_PROXY_TOKEN: proxyToken,
			PROOF_ADMIN_HOST: "admin.test",
			ASTRO_NODE_AUTOSTART: "disabled",
			DATABASE_URL: databaseUrl,
			CLERK_JWT_KEY: jwtKey,
			CLERK_SECRET_KEY: "sk_test_fixture",
			PROOF_CLERK_API_URL: `http://127.0.0.1:${clerkFixture.address().port}`,
			PROOF_CLERK_ISSUER: issuer,
			PROOF_ADMIN_ORIGIN: origin,
		},
		stdio: "inherit",
	});
	await waitFor(async () => {
		if (host.exitCode !== null) throw new Error("Node host exited");
		return (await request("unknown.test", "/", 18081)).status === 421;
	});

	const caddy = await container(
		"caddy:2-alpine",
		[
			"-v",
			`${resolve(root, "infra/shared-host/Caddyfile")}:/etc/caddy/Caddyfile:ro`,
			"-e",
			`PROOF_PROXY_TOKEN=${proxyToken}`,
		],
		["caddy", "run", "--config", "/etc/caddy/Caddyfile"],
	);
	await waitFor(
		async () =>
			(await command("docker", ["inspect", "-f", "{{.State.Running}}", caddy])) === "true" &&
			(await request("unknown.test")).status === 421,
	);

	const styles = new Map();
	for (const [site, greeting] of [
		["foo", "Hello from Foo"],
		["bar", "Hello from Bar"],
	]) {
		const page = await request(`${site}.test`);
		assert.equal(page.status, 200);
		const html = page.text();
		assert.match(html, new RegExp(`${site} presentation`));
		assert.match(html, new RegExp(greeting));
		assert.match(html, new RegExp(`Site ID: site-${site}`));
		assert.match(html, new RegExp(`Published entry: ${site === "foo" ? "Foo" : "Bar"} story`));
		const ownEntry = await request(`${site}.test`, "/entry/shared.json");
		assert.equal(ownEntry.status, 200);
		assert.deepEqual(JSON.parse(ownEntry.text()), {
			title: `${site === "foo" ? "Foo" : "Bar"} story`,
		});
		assert.equal((await request(`${site}.test`, "/mark.svg")).status, 200);
		assert.match((await request(`${site}.test`, "/mark.svg")).text(), new RegExp(`${site} asset`));
		const stylesheet = await request(`${site}.test`, "/style.css");
		assert.equal(stylesheet.status, 200);
		styles.set(site, stylesheet.text());
	}
	assert.notEqual(styles.get("foo"), styles.get("bar"));
	const login = await request("admin.test", "/_emdash/admin/login");
	assert.equal(login.status, 200);
	assert.equal(login.headers["cache-control"], "private, no-store");
	assert.match(login.text(), /Sign in to EmDash/);
	assert.match(login.text(), /https:\/\/fixture.accounts.dev\/sign-in/);
	assert.match(login.text(), /redirect_url=http%3A%2F%2Fadmin.test%2F_emdash%2Fadmin%2Flogin/);
	const adminScript = login.text().match(/(?:src|component-url)="(\/_astro\/[^"]+\.js)"/)?.[1];
	assert.ok(adminScript, "The admin shell loads a client application");
	assert.equal((await request("admin.test", adminScript)).status, 200);
	assert.equal((await request("foo.test", adminScript)).status, 404);
	assert.equal((await request("admin.test", "/admin")).status, 302);
	const noAccess = "/_emdash/admin/no-access";
	assert.equal((await request("admin.test", noAccess)).status, 302);
	const valid = await session();
	assert.equal(
		(await request("admin.test", noAccess, 18080, { Cookie: `__session=${valid}` })).status,
		200,
	);
	assert.match(
		(await request("admin.test", noAccess, 18080, { Cookie: `__session=${valid}` })).text(),
		/No site access/,
	);
	assert.equal(
		(await request("admin.test", noAccess, 18080, { Cookie: `__session=${valid}x` })).status,
		302,
	);
	const forged = await new SignJWT({ sid: "sess_fixture", azp: origin })
		.setProtectedHeader({ alg: "RS256" })
		.setIssuer(issuer)
		.setSubject("user_fixture")
		.setIssuedAt()
		.setExpirationTime("5m")
		.sign(otherPrivateKey);
	assert.equal(
		(await request("admin.test", noAccess, 18080, { Cookie: `__session=${forged}` })).status,
		302,
	);
	const expired = new SignJWT({ sid: "sess_fixture", azp: origin })
		.setProtectedHeader({ alg: "RS256" })
		.setIssuer(issuer)
		.setSubject("user_fixture")
		.setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
		.setExpirationTime(Math.floor(Date.now() / 1000) - 3500)
		.sign(privateKey);
	assert.equal(
		(await request("admin.test", noAccess, 18080, { Cookie: `__session=${await expired}` })).status,
		302,
	);
	assert.equal(
		(
			await request("admin.test", noAccess, 18080, {
				Cookie: `__session=${await session({ subject: "user_unknown" })}`,
			})
		).status,
		302,
	);
	assert.equal(
		(
			await request("admin.test", noAccess, 18080, {
				Cookie: `__session=${await session({ sid: "sess_outage" })}`,
			})
		).status,
		302,
	);
	assert.equal(
		(
			await request("admin.test", noAccess, 18080, {
				Cookie: `__session=${await session({ azp: "http://foo.test" })}`,
			})
		).status,
		302,
	);
	assert.equal(
		(
			await request("admin.test", noAccess, 18080, {
				Cookie: `__session=${await session({ issuer: "https://other.clerk.accounts.dev" })}`,
			})
		).status,
		302,
	);
	assert.equal(
		(await request("admin.test", noAccess, 18080, { Cookie: "__session=" })).status,
		302,
	);
	assert.equal(
		(
			await request(
				"admin.test",
				"/_emdash/api/auth/logout",
				18080,
				{ Cookie: `__session=${valid}` },
				"POST",
			)
		).status,
		403,
	);
	assert.equal(
		(
			await request(
				"admin.test",
				"/_emdash/api/auth/logout",
				18080,
				{
					Cookie: `__session=${valid}`,
					Origin: origin,
					"X-EmDash-Request": "1",
				},
				"POST",
			)
		).status,
		204,
	);
	assert.equal(
		(await request("admin.test", noAccess, 18080, { Cookie: `__session=${valid}` })).status,
		302,
	);
	assert.equal((await request("foo.test", "/")).status, 200);
	assert.equal(
		(await request("admin.test", "/_emdash/api/health", 18080, { Cookie: `__session=${valid}` }))
			.status,
		403,
	);
	assert.equal(
		(
			await request("admin.test", "/_emdash/api/settings?siteId=site-foo", 18080, {
				Cookie: `__session=${await session({ role: "admin", public_metadata: { is_super_admin: true } })}`,
			})
		).status,
		403,
	);
	assert.equal((await request("admin.test", "/_emdash/api/health")).status, 403);
	assert.equal((await request("admin.test", "/_emdash/api/settings?siteId=site-foo")).status, 403);
	assert.equal((await request("admin.test", "/_emdash/admin/settings")).status, 403);
	assert.equal((await request("admin.test", "/preview/foo")).status, 403);
	assert.equal(
		(await request("admin.test", "/_emdash/api/content/posts", 18080, {}, "POST")).status,
		421,
	);
	assert.equal(
		(
			await request("admin.test", "/_emdash/api/content/posts", 18080, {
				"X-Site-Id": "site-foo",
			})
		).status,
		403,
	);
	assert.equal(
		(await request("admin.test", "/_emdash/admin/login", 18080, { Forwarded: "host=foo.test" }))
			.status,
		421,
	);
	assert.equal((await request("foo.test", "/_emdash/admin/login")).status, 421);
	assert.equal((await request("foo.test", "/admin")).status, 421);
	assert.equal((await request("foo.test", "/_astro/anything.js")).status, 404);
	assert.equal((await request("foo.test", "/preview/foo")).status, 421);
	assert.equal((await request("foo.test", "/%5Femdash/admin/login")).status, 404);
	assert.equal((await request("unknown.test")).status, 421);
	assert.equal((await request("unknown.test", "/mark.svg")).status, 421);
	assert.equal((await request("unknown.test", "/entry/shared.json")).status, 421);
	assert.equal((await request("bar.test", "/entry/foo-entry.json")).status, 404);
	assert.equal(
		(await request("admin.test", "/", 18080, { "X-Forwarded-Host": "foo.test" })).status,
		403,
	);
	assert.equal((await request("foo.test", "/_emdash/api/auth/dev-bypass")).status, 421);
	assert.equal((await request("bar.test", "/entry/exclusive.json")).status, 404);
	assert.equal((await request("foo.test", "/entry/bar-entry.json")).status, 404);
	assert.equal(
		(await request("unknown.test", "/", 18080, { "X-Forwarded-Host": "foo.test" })).status,
		421,
	);
	assert.equal((await request("unknown.test", "/", 18081)).status, 421);
	assert.equal((await request("unknown.test", "/?siteId=site-foo")).status, 421);
	assert.equal((await request("foo.test", "/_emdash/admin")).status, 421);
	assert.equal((await request("foo.test", "/_emdash/api/content/posts")).status, 421);
	assert.equal((await request("foo.test", "/", 18081)).status, 421);
	assert.equal((await request("admin.test", "/_emdash/admin/login", 18081)).status, 421);
	assert.equal(
		(
			await request("foo.test", "/", 18081, {
				"X-Proof-Proxy-Token": proxyToken,
				"X-Forwarded-Host": "bar.test",
			})
		).status,
		421,
	);
	assert.equal(
		(await request("foo.test", "/", 18080, { "X-Forwarded-Host": "bar.test" })).status,
		200,
	);
	await command("docker", [
		"exec",
		pg,
		"psql",
		"-p",
		"55432",
		"-U",
		"postgres",
		"-c",
		"UPDATE _emdash_sites SET slug = 'renamed' WHERE id = 'site-foo'; UPDATE _emdash_site_hosts SET hostname = 'new.test' WHERE site_id = 'site-foo'",
	]);
	assert.equal((await request("foo.test")).status, 421);
	assert.equal((await request("new.test")).status, 200);
	assert.match((await request("new.test")).text(), /foo presentation/);
	assert.match((await request("new.test")).text(), /Site ID: site-foo/);
	await command("docker", [
		"exec",
		pg,
		"psql",
		"-p",
		"55432",
		"-U",
		"postgres",
		"-c",
		"UPDATE _emdash_site_hosts SET hostname = 'foo.test' WHERE site_id = 'site-foo'; UPDATE _emdash_sites SET active = 0 WHERE id = 'site-bar'",
	]);
	assert.equal((await request("foo.test")).status, 200);
	assert.equal((await request("bar.test")).status, 421);
	await command("docker", [
		"exec",
		pg,
		"psql",
		"-p",
		"55432",
		"-U",
		"postgres",
		"-c",
		"INSERT INTO _emdash_site_hosts VALUES ('admin.test', 'site-foo')",
	]);
	assert.equal((await request("admin.test", "/_emdash/admin/login")).status, 421);
	await command("docker", [
		"exec",
		pg,
		"psql",
		"-p",
		"55432",
		"-U",
		"postgres",
		"-c",
		"DELETE FROM _emdash_site_hosts WHERE hostname = 'admin.test'",
	]);

	host.kill();
	await new Promise((done) => host.once("exit", done));
	origin = "http://localhost:18080";
	sessionActive = true;
	host = spawn(process.execPath, [resolve(root, "infra/shared-host/host.mjs")], {
		cwd: root,
		env: {
			...process.env,
			PROOF_PORT: "18081",
			PROOF_PROXY_TOKEN: proxyToken,
			PROOF_ADMIN_HOST: "localhost",
			ASTRO_NODE_AUTOSTART: "disabled",
			DATABASE_URL: databaseUrl,
			CLERK_JWT_KEY: jwtKey,
			CLERK_SECRET_KEY: "sk_test_fixture",
			PROOF_CLERK_API_URL: `http://127.0.0.1:${clerkFixture.address().port}`,
			PROOF_CLERK_ISSUER: issuer,
			PROOF_ADMIN_ORIGIN: origin,
		},
		stdio: "inherit",
	});
	await waitFor(async () => (await request("localhost", "/_emdash/admin/login")).status === 200);
	const browser = await chromium.launch({
		...(existsSync("/usr/bin/chromium") ? { executablePath: "/usr/bin/chromium" } : {}),
		args: ["--no-sandbox"],
	});
	try {
		const page = await browser.newPage();
		const loginPath = "/_emdash/admin/login";
		await page.route("https://fixture.accounts.dev/**", async (route) => {
			await page.context().addCookies([
				{
					name: "__session",
					value: await session(),
					url: origin,
				},
			]);
			await route.fulfill({
				status: 302,
				headers: { Location: `${origin}/_emdash/admin/no-access` },
			});
		});
		await page.goto(`${origin}${loginPath}`);
		await page.getByRole("link", { name: "Continue to Clerk" }).click();
		await page.getByRole("heading", { name: "No site access" }).waitFor();
		assert.equal(page.url(), `${origin}/_emdash/admin/no-access`);
		assert.equal(
			(await page.request.get(`${origin}/_emdash/api/settings?siteId=site-foo`)).status(),
			403,
		);
		await page.getByRole("button", { name: "Sign out" }).click();
		await page.waitForURL(`${origin}${loginPath}`);
		assert.equal(
			(await page.request.get(`${origin}/_emdash/admin/no-access`, { maxRedirects: 0 })).status(),
			302,
		);
		await page.context().addCookies([
			{
				name: "__session",
				value: `${await session()}x`,
				url: origin,
			},
		]);
		await page.goto(`${origin}/_emdash/admin/no-access`);
		assert.equal(page.url(), `${origin}${loginPath}`);
		await page.route("https://fixture.accounts.dev/**", (route) =>
			route.fulfill({ status: 503, body: "Unavailable" }),
		);
		await page.getByRole("link", { name: "Continue to Clerk" }).click();
		assert.match(await page.locator("body").innerText(), /Unavailable/);
		assert.equal(
			(await page.request.get(`${origin}/_emdash/admin/no-access`, { maxRedirects: 0 })).status(),
			302,
		);
		sessionActive = true;
		await page.setExtraHTTPHeaders({ "Accept-Language": "ar" });
		await page.context().addCookies([
			{
				name: "__session",
				value: await session(),
				url: origin,
			},
		]);
		await page.goto(`${origin}/_emdash/admin/no-access`);
		assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
		assert.equal((await request("foo.test")).status, 200);
	} finally {
		await browser.close();
	}

	const nodeStatus = await readFile(`/proc/${host.pid}/status`, "utf8");
	const caddyStatus = await command("docker", [
		"exec",
		caddy,
		"sh",
		"-c",
		"grep VmRSS /proc/1/status",
	]);
	console.log(`Node PID ${host.pid}: ${nodeStatus.match(/^VmRSS:.*$/m)?.[0]}`);
	console.log(`Caddy: ${caddyStatus}`);
	console.log("Two public presentations and the admin area passed real HTTP checks through Caddy.");
} finally {
	if (host) {
		host.kill();
	}
	if (clerkFixture) clerkFixture.close();
	for (const id of containers.toReversed()) {
		await command("docker", ["stop", id]).catch(() => {});
	}
}
