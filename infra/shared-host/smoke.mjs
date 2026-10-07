import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const fixture = resolve(root, "demos/postgres/proof");
const databaseUrl = "postgres://postgres:proof@127.0.0.1:55432/postgres";
const proxyToken = "proof-only-proxy-token";
const containers = [];
let host;

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

function request(hostname, path = "/", port = 18080, headers = {}) {
	return new Promise((resolveResponse, reject) => {
		const req = httpRequest(
			{ hostname: "127.0.0.1", port, path, headers: { Host: hostname, ...headers } },
			(res) => {
				const chunks = [];
				res.on("data", (chunk) => chunks.push(chunk));
				res.on("end", () =>
					resolveResponse({ status: res.statusCode, text: () => Buffer.concat(chunks).toString() }),
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
		"CREATE TABLE proof_sites (name text PRIMARY KEY, greeting text NOT NULL); INSERT INTO proof_sites VALUES ('foo', 'Hello from Foo'), ('bar', 'Hello from Bar'); CREATE TABLE _emdash_sites (id text PRIMARY KEY, slug text UNIQUE NOT NULL, active integer NOT NULL DEFAULT 1); CREATE TABLE _emdash_site_hosts (hostname text PRIMARY KEY, site_id text NOT NULL REFERENCES _emdash_sites(id)); INSERT INTO _emdash_sites (id, slug) VALUES ('site-foo', 'foo'), ('site-bar', 'bar'); INSERT INTO _emdash_site_hosts VALUES ('foo.test', 'site-foo'), ('bar.test', 'site-bar')",
	]);

	for (const site of ["foo", "bar"]) {
		await command(resolve(root, "demos/postgres/node_modules/.bin/astro"), ["build"], {
			cwd: fixture,
			env: { ...process.env, PROOF_SITE: site, PUBLIC_PROOF_SITE: site },
		});
		await writeFile(
			resolve(fixture, `dist/${site}/client/mark.svg`),
			`<svg xmlns="http://www.w3.org/2000/svg"><title>${site} asset</title></svg>\n`,
		);
	}

	host = spawn(process.execPath, [resolve(root, "infra/shared-host/host.mjs")], {
		cwd: root,
		env: {
			...process.env,
			PROOF_PORT: "18081",
			PROOF_PROXY_TOKEN: proxyToken,
			ASTRO_NODE_AUTOSTART: "disabled",
			DATABASE_URL: databaseUrl,
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
		assert.equal((await request(`${site}.test`, "/mark.svg")).status, 200);
		assert.match((await request(`${site}.test`, "/mark.svg")).text(), new RegExp(`${site} asset`));
		assert.equal((await request(`${site}.test`, "/style.css")).status, 200);
	}
	assert.equal((await request("unknown.test")).status, 421);
	assert.equal((await request("unknown.test", "/mark.svg")).status, 421);
	assert.equal(
		(await request("unknown.test", "/", 18080, { "X-Forwarded-Host": "foo.test" })).status,
		421,
	);
	assert.equal((await request("unknown.test", "/", 18081)).status, 421);
	assert.equal((await request("unknown.test", "/?siteId=site-foo")).status, 421);
	assert.equal((await request("foo.test", "/_emdash/admin")).status, 421);
	assert.equal((await request("foo.test", "/_emdash/api/content/posts")).status, 421);
	assert.equal((await request("foo.test", "/", 18081)).status, 421);
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
	console.log("Two presentations and their assets passed real HTTP checks through Caddy.");
} finally {
	if (host) {
		host.kill();
	}
	for (const id of containers.toReversed()) {
		await command("docker", ["stop", id]).catch(() => {});
	}
}
