import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { resolve } from "node:path";

import { expect, it, vi } from "vitest";

import { main } from "../src/cli.js";
import { startClerkFixture } from "./clerk-fixture.js";
import { linkScaffoldDependencies } from "./scaffold-dependencies.js";

const template = resolve(import.meta.dirname, "../../../templates/blog");

type HttpResult = {
	status: number;
	body: string;
	headers: import("node:http").IncomingHttpHeaders;
};

function request(
	port: number,
	hostname: string,
	path: string,
	headers: Record<string, string> = {},
	method = "GET",
): Promise<HttpResult> {
	return new Promise((done, fail) => {
		const req = httpRequest(
			{
				hostname: "127.0.0.1",
				port,
				path,
				method,
				headers: { Host: `${hostname}:${port}`, ...headers },
			},
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => (body += chunk));
				res.on("end", () => done({ status: res.statusCode ?? 0, body, headers: res.headers }));
			},
		);
		req.setTimeout(15_000, () => req.destroy(new Error("request timed out")));
		req.on("error", (error) =>
			fail(new Error(`${method} ${hostname}${path}: ${error.message}`, { cause: error })),
		);
		req.end();
	});
}

async function availablePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Expected a TCP address");
	await new Promise<void>((done) => server.close(() => done()));
	return address.port;
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
	for (let i = 0; i < 150; i++) {
		try {
			if (await check()) return;
		} catch {
			// The process may still be starting.
		}
		await new Promise((done) => setTimeout(done, 100));
	}
	throw new Error("Generated multisite host did not become ready");
}

it("initializes with no sites, then serves explicit sites behind verified super-admin access", async () => {
	const workdir = resolve(template, "../.astro");
	mkdirSync(workdir, { recursive: true });
	const keep = process.env.EMDASH_KEEP_INSTALL === "1";
	const workspace = keep
		? resolve(workdir, "local-install")
		: mkdtempSync(resolve(workdir, "step3-install-"));
	if (keep && existsSync(resolve(workspace, "site")))
		throw new Error("Reset the existing local installation first");
	mkdirSync(workspace, { recursive: true });
	const project = resolve(workspace, "site");
	let completed = false;
	let host: ChildProcess | undefined;
	let clerk: Awaited<ReturnType<typeof startClerkFixture>> | undefined;
	const password = crypto.randomUUID();
	const container = execFileSync(
		"docker",
		[
			"run",
			"-d",
			"--rm",
			"-p",
			"127.0.0.1::5432",
			"-e",
			`POSTGRES_PASSWORD=${password}`,
			"-e",
			"POSTGRES_DB=test",
			"postgres:16-alpine",
		],
		{ encoding: "utf8" },
	).trim();
	const originalCwd = process.cwd();
	const originalArgv = process.argv;
	try {
		const mapping = execFileSync("docker", ["port", container, "5432"], { encoding: "utf8" });
		const pgPort = Number(mapping.match(/127\.0\.0\.1:(\d+)/)?.[1]);
		if (!pgPort) throw new Error("Missing PostgreSQL port");
		for (let attempt = 0; attempt < 100; attempt++) {
			try {
				execFileSync(
					"docker",
					["exec", container, "psql", "-U", "postgres", "-d", "test", "-c", "SELECT 1"],
					{ stdio: "ignore" },
				);
				break;
			} catch {
				await new Promise((done) => setTimeout(done, 100));
			}
		}
		const localTemplate = async (_source: string, options: { dir: string }) => {
			cpSync(template, options.dir, {
				recursive: true,
				filter: (source) =>
					!source.split("/").some((part) => ["dist", "node_modules", ".astro"].includes(part)),
			});
		};
		vi.spyOn(console, "clear").mockImplementation(() => {});
		process.chdir(workspace);
		process.argv = [
			process.execPath,
			"create-emdash",
			"site",
			"--platform",
			"node",
			"--template",
			"blog",
			"--pm",
			"pnpm",
			"--no-install",
			"--yes",
		];
		await main(localTemplate);
		process.chdir(originalCwd);
		const seedPath = resolve(project, "seed/seed.json");
		const seed = JSON.parse(readFileSync(seedPath, "utf8"));
		for (const post of seed.content.posts) delete post.data.featured_image;
		writeFileSync(seedPath, JSON.stringify(seed));
		linkScaffoldDependencies(project);
		const port = await availablePort();
		clerk = await startClerkFixture(`http://localhost:${port}`);
		const databaseUrl = `postgres://postgres:${password}@127.0.0.1:${pgPort}/test`;
		const encryptionKey = readFileSync(resolve(project, ".env"), "utf8").match(
			/^EMDASH_ENCRYPTION_KEY=(.+)$/m,
		)?.[1];
		if (!encryptionKey) throw new Error("Scaffold did not create an encryption key");
		writeFileSync(
			resolve(project, ".env"),
			`${readFileSync(resolve(project, ".env"), "utf8")}\nDATABASE_URL=${databaseUrl}\n`,
		);
		const env = {
			...process.env,
			DATABASE_URL: databaseUrl,
			EMDASH_ENCRYPTION_KEY: encryptionKey,
			NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerk.publishableKey,
			CLERK_SECRET_KEY: "sk_test_fixture",
			CLERK_BOOTSTRAP_USER_ID: "user_configured_bootstrap_not_admin",
			CLERK_JWT_KEY: clerk.publicKey,
			EMDASH_CLERK_API_URL: clerk.url,
			PORT: String(port),
		};
		const build = () =>
			execFileSync(process.execPath, [resolve(project, "build.mjs")], {
				cwd: project,
				env,
				timeout: 180_000,
				stdio: "pipe",
			});
		const buildAsync = () =>
			new Promise<void>((resolveBuild, rejectBuild) => {
				const child = spawn(process.execPath, [resolve(project, "build.mjs")], {
					cwd: project,
					env,
					stdio: "pipe",
				});
				let output = "";
				const timeout = setTimeout(() => child.kill("SIGTERM"), 180_000);
				child.stdout?.setEncoding("utf8").on("data", (chunk) => (output += chunk));
				child.stderr?.setEncoding("utf8").on("data", (chunk) => (output += chunk));
				child.once("error", (error) => {
					clearTimeout(timeout);
					rejectBuild(error);
				});
				child.once("exit", (code, signal) => {
					clearTimeout(timeout);
					if (code === 0) resolveBuild();
					else
						rejectBuild(
							new Error(`Generated presentation build failed (${signal ?? code}): ${output}`),
						);
				});
			});
		let hostOutput = "";
		let hostErrorOutput = "";
		const startHost = () => {
			hostOutput = "";
			hostErrorOutput = "";
			host = spawn(process.execPath, [resolve(project, "host.mjs")], {
				cwd: project,
				env,
				stdio: ["ignore", "pipe", "pipe"],
			});
			host.stdout?.setEncoding("utf8").on("data", (chunk) => (hostOutput += chunk));
			host.stderr?.setEncoding("utf8").on("data", (chunk) => {
				hostErrorOutput += chunk;
				console.error("[fixture host]", String(chunk));
			});
		};
		let clerkRequestsAtProbe = 0;
		const requestHost = async (
			hostname: string,
			path: string,
			headers: Record<string, string> = {},
		) => {
			try {
				return await request(port, hostname, path, headers);
			} catch (error) {
				throw new Error(
					`${String(error)}\\nHost exit code: ${host?.exitCode}\\nClerk fixture requests: ${clerkRequestsAtProbe} -> ${clerk?.state.requests ?? "unavailable"}\\nHost stdout:\\n${hostOutput}\\nHost stderr:\\n${hostErrorOutput}`,
					{ cause: error },
				);
			}
		};
		const cookie = { Cookie: `__session=${clerk.jwt()}` };
		const query = (sql: string) =>
			execFileSync(
				"docker",
				["exec", container, "psql", "-U", "postgres", "-d", "test", "-t", "-A", "-c", sql],
				{ encoding: "utf8" },
			).trim();

		build();
		startHost();
		await waitFor(async () => (await request(port, "localhost", "/admin")).status === 302);
		expect((await request(port, "localhost", "/admin", cookie)).headers.location).toBe("/sites");
		expect((await request(port, "localhost", "/sites", cookie)).body).toContain("No sites yet");
		expect(query("SELECT count(*) FROM _emdash_sites")).toBe("0");
		{
			const { chromium } = await import("../../../node_modules/@playwright/test/index.mjs");
			const browser = await chromium.launch();
			try {
				for (const locale of ["en", "ar"] as const) {
					const context = await browser.newContext({
						locale,
						viewport: { width: 1440, height: 900 },
					});
					await context.addCookies([
						{ name: "__session", value: clerk.jwt(), url: `http://localhost:${port}` },
					]);
					const page = await context.newPage();
					await page.goto(`http://localhost:${port}/sites`);
					await page.getByRole("heading", { name: "Sites", exact: true }).waitFor();
					await page.locator("main section").waitFor();
					const layout = await page.evaluate(() => {
						const mainElement = document.querySelector("main")!;
						const heading = mainElement.querySelector("h1")!;
						const card = mainElement.querySelector("section")!;
						const mainRect = mainElement.getBoundingClientRect();
						const headingRect = heading.getBoundingClientRect();
						const cardRect = card.getBoundingClientRect();
						return {
							viewportWidth: window.innerWidth,
							mainWidth: mainRect.width,
							cardHeadingGap: cardRect.top - headingRect.bottom,
						};
					});
					for (const width of [1440, 390]) {
						await page.setViewportSize({ width, height: 900 });
						const geometry = await page.evaluate(() => {
							const mainRect = document.querySelector("main")!.getBoundingClientRect();
							const headingRect = document.querySelector("main h1")!.getBoundingClientRect();
							const brandRect = document
								.querySelector("header > div > span")!
								.getBoundingClientRect();
							const rtl = getComputedStyle(document.documentElement).direction === "rtl";
							return {
								mainRect,
								headingStart: rtl ? headingRect.right : headingRect.left,
								brandStart: rtl ? brandRect.right : brandRect.left,
								viewportWidth: window.innerWidth,
							};
						});
						if (width === 1440) {
							expect(geometry.mainRect.width).toBeLessThan(geometry.viewportWidth);
						} else {
							expect(geometry.mainRect.left).toBeGreaterThanOrEqual(0);
							expect(geometry.mainRect.right).toBeLessThanOrEqual(geometry.viewportWidth);
						}
						expect(Math.abs(geometry.brandStart - geometry.headingStart)).toBeLessThanOrEqual(1);
					}
					expect(layout.mainWidth).toBeLessThan(layout.viewportWidth);
					expect(layout.cardHeadingGap).toBeGreaterThanOrEqual(24);
					if (process.env.EMDASH_CAPTURE_SETUP) {
						await page.setViewportSize({ width: 1440, height: 900 });
						await page.screenshot({ path: `/tmp/emdash-26-empty-${locale}.png`, fullPage: true });
					}
					await context.close();
				}
			} finally {
				await browser.close();
			}
		}
		expect(query("SELECT value FROM options WHERE name = 'emdash:setup_complete'")).toBe("true");
		expect(hostOutput).toContain(`[host] Ready: admin http://localhost:${port}/admin`);
		expect(hostOutput).not.toContain("Public site: http://default.localhost");
		expect((await request(port, "default.localhost", "/")).status).toBe(421);
		host.kill();
		await new Promise<void>((done) => host?.once("exit", () => done()));
		startHost();
		await waitFor(async () => (await request(port, "localhost", "/admin", cookie)).status === 302);
		expect(query("SELECT count(*) FROM _emdash_sites")).toBe("0");
		for (const [path, method] of [
			["/_emdash/admin/setup", "GET"],
			["/_emdash/api/setup/status", "GET"],
			["/_emdash/api/setup", "POST"],
			["/_emdash/api/setup/dev-bypass", "GET"],
			["/_emdash/api/auth/dev-bypass", "GET"],
		] as const) {
			expect((await request(port, "localhost", path, cookie, method)).status).toBe(403);
		}
		expect((await request(port, "localhost", "/_emdash/api/setup%2fstatus", cookie)).status).toBe(
			421,
		);
		expect(
			(await request(port, "localhost", "/_emdash/api/setup/status", cookie, "HEAD")).status,
		).toBe(403);
		const anonymousSite = await request(port, "localhost", "/site/bar");
		expect(anonymousSite.headers.location).toBe("/login?redirect=%2Fsite%2Fbar");
		const anonymousAdmin = await request(
			port,
			"localhost",
			"/admin?redirect=https://attacker.example",
		);
		expect(anonymousAdmin.headers.location).toBe("/login?redirect=%2Fsites");

		const cli = resolve(import.meta.dirname, "../dist/index.mjs");
		const addSite = (slug: string) =>
			execFileSync(process.execPath, [cli, "site", slug], {
				cwd: project,
				env,
				encoding: "utf8",
				timeout: 30_000,
			});
		expect(addSite("foo")).toContain("Site foo registered");
		expect(addSite("bar")).toContain("Site bar registered");
		const registeredBeforeBuild = await request(
			port,
			"localhost",
			"/_emdash/api/system/sites?limit=100",
			cookie,
		);
		expect(registeredBeforeBuild.status).toBe(200);
		const registeredData = JSON.parse(registeredBeforeBuild.body).data.items;
		expect(registeredData.map((site: { slug: string }) => site.slug)).toEqual(["bar", "foo"]);
		expect(
			registeredData.every(
				(site: { readiness: { status: string } }) => site.readiness.status === "unavailable",
			),
		).toBe(true);
		const unavailablePublic = await request(port, "foo.localhost", "/");
		expect(unavailablePublic.status).toBe(503);
		expect(unavailablePublic.body).toBe("");
		{
			const { chromium } = await import("../../../node_modules/@playwright/test/index.mjs");
			const browser = await chromium.launch();
			try {
				const context = await browser.newContext({ locale: "en" });
				await context.addCookies([
					{ name: "__session", value: clerk.jwt(), url: `http://localhost:${port}` },
				]);
				const page = await context.newPage();
				await page.goto(`http://localhost:${port}/sites`);
				await page.getByRole("main").getByRole("link", { name: "foo" }).waitFor();
				expect(await page.locator("main").innerText()).toContain("Unavailable");
				expect(await page.locator("main").innerText()).toContain(
					"Check the installed site build and host logs",
				);
				if (process.env.EMDASH_CAPTURE_SETUP) {
					await page.screenshot({
						path: "/tmp/emdash-56-sites-unavailable-en.png",
						fullPage: true,
					});
				}
				await context.close();
			} finally {
				await browser.close();
			}
		}
		const collectionsBefore = query("SELECT count(*) FROM _emdash_collections");
		const fieldsBefore = query("SELECT count(*) FROM _emdash_fields");
		const fooPosts = query(
			"SELECT count(*) FROM ec_posts WHERE site_id = (SELECT id FROM _emdash_sites WHERE slug = 'foo')",
		);
		const barPosts = query(
			"SELECT count(*) FROM ec_posts WHERE site_id = (SELECT id FROM _emdash_sites WHERE slug = 'bar')",
		);
		expect(Number(fooPosts)).toBeGreaterThan(0);
		expect(Number(barPosts)).toBeGreaterThan(0);
		for (const slug of ["foo", "bar"]) {
			const ownedRows = query(
				`SELECT (SELECT count(*) FROM taxonomies WHERE site_id = s.id), (SELECT count(*) FROM _emdash_bylines WHERE site_id = s.id), (SELECT count(*) FROM _emdash_menus WHERE site_id = s.id), (SELECT count(*) FROM options WHERE site_id = s.id) FROM _emdash_sites s WHERE slug = '${slug}'`,
			);
			expect(
				ownedRows
					.split("|")
					.map(Number)
					.every((count) => count > 0),
			).toBe(true);
		}
		expect(query("SELECT count(*) FROM _emdash_collections")).toBe(collectionsBefore);
		expect(query("SELECT count(*) FROM _emdash_fields")).toBe(fieldsBefore);
		query(
			"UPDATE ec_posts SET title = 'Foo only marker' WHERE slug = 'a-weekend-with-a-side-project' AND site_id = (SELECT id FROM _emdash_sites WHERE slug = 'foo')",
		);
		query(
			"UPDATE ec_posts SET title = 'Bar only marker' WHERE slug = 'a-weekend-with-a-side-project' AND site_id = (SELECT id FROM _emdash_sites WHERE slug = 'bar')",
		);
		query(
			"UPDATE taxonomies SET label = 'Foo development' WHERE site_id = (SELECT id FROM _emdash_sites WHERE slug = 'foo') AND name = 'category' AND slug = 'development'",
		);
		query(
			"UPDATE taxonomies SET label = 'Bar development' WHERE site_id = (SELECT id FROM _emdash_sites WHERE slug = 'bar') AND name = 'category' AND slug = 'development'",
		);
		query(
			"UPDATE _emdash_menu_items SET label = 'Foo navigation marker' WHERE site_id = (SELECT id FROM _emdash_sites WHERE slug = 'foo') AND label = 'About'",
		);
		query(
			"UPDATE _emdash_menu_items SET label = 'Bar navigation marker' WHERE site_id = (SELECT id FROM _emdash_sites WHERE slug = 'bar') AND label = 'About'",
		);
		expect(query("SELECT string_agg(slug, ',' ORDER BY slug) FROM _emdash_sites")).toBe("bar,foo");
		const beforeRetry = query("SELECT count(*) FROM ec_posts");
		const fooHome = resolve(project, "src/foo/pages/index.astro");
		const fooPresentation = `${readFileSync(fooHome, "utf8")}\n<p>Foo presentation marker</p>\n`;
		writeFileSync(fooHome, fooPresentation);
		writeFileSync(
			resolve(project, "src/foo/pages/café.astro"),
			"<html><body>Unicode public route</body></html>",
		);
		expect(addSite("foo")).toContain("Site foo registered");
		expect(readFileSync(fooHome, "utf8")).toBe(fooPresentation);
		expect(query("SELECT count(*) FROM ec_posts")).toBe(beforeRetry);
		expect(query("SELECT count(*) FROM _emdash_collections")).toBe(collectionsBefore);
		expect(query("SELECT count(*) FROM _emdash_fields")).toBe(fieldsBefore);
		mkdirSync(resolve(project, "src/occupied"));
		expect(() => addSite("occupied")).toThrow(
			"conflicts with an existing hostname or presentation",
		);
		expect(query("SELECT count(*) FROM _emdash_sites WHERE slug = 'occupied'")).toBe("0");
		rmSync(resolve(project, "src/occupied"), { recursive: true, force: true });
		query(
			"INSERT INTO _emdash_site_hosts (hostname, site_id) SELECT 'taken.localhost', id FROM _emdash_sites WHERE slug = 'foo'",
		);
		expect(() => addSite("taken")).toThrow("conflicts with an existing hostname or presentation");
		expect(query("SELECT count(*) FROM _emdash_sites WHERE slug = 'taken'")).toBe("0");
		query("DELETE FROM _emdash_site_hosts WHERE hostname = 'taken.localhost'");
		expect(() => addSite("default")).toThrow("unique lowercase slug");
		expect(query("SELECT count(*) FROM _emdash_sites WHERE slug = 'default'")).toBe("0");
		build();
		host.kill();
		await new Promise<void>((done) => host?.once("exit", () => done()));
		startHost();
		await waitFor(async () => (await request(port, "foo.localhost", "/")).status === 200);
		await waitFor(async () =>
			hostOutput.includes(`[host] Public site: http://bar.localhost:${port}`),
		);
		expect(hostOutput).toContain(`[host] Public site: http://foo.localhost:${port}`);
		expect(hostOutput).not.toContain("Public site: http://default.localhost");
		expect(query("SELECT count(*) FROM _emdash_sites")).toBe("2");
		expect((await request(port, "foo.localhost", "/readiness-check")).status).toBe(404);
		const initialFooVersion = JSON.parse(
			readFileSync(resolve(project, "dist/sites/foo/version.json"), "utf8"),
		).version;
		for (let visit = 0; visit < 2; visit++) {
			const fooCategory = await request(port, "foo.localhost", "/category/development");
			const barCategory = await request(port, "bar.localhost", "/category/development");
			expect(fooCategory.status).toBe(200);
			expect(barCategory.status).toBe(200);
			expect(fooCategory.body).toContain("Foo development");
			expect(fooCategory.body).not.toContain("Bar development");
			expect(barCategory.body).toContain("Bar development");
			expect(barCategory.body).not.toContain("Foo development");
		}
		writeFileSync(
			resolve(project, "src/foo/pages/readiness-check.astro"),
			"<html><body>New foo presentation version</body></html>",
		);
		await buildAsync();
		expect((await requestHost("foo.localhost", "/")).status).toBe(200);
		expect((await requestHost("foo.localhost", "/readiness-check")).status).toBe(404);
		expect((await requestHost("localhost", "/admin", cookie)).status).toBe(302);
		clerkRequestsAtProbe = clerk.state.requests;
		const latestFooVersion = JSON.parse(
			readFileSync(resolve(project, "dist/sites/foo/version.json"), "utf8"),
		).version;
		const readinessResponse = await requestHost(
			"localhost",
			"/_emdash/api/system/sites/foo",
			cookie,
		);
		expect(readinessResponse.status).toBe(200);
		expect(JSON.parse(readinessResponse.body).data.readiness).toMatchObject({
			status: "ready",
			loadedVersion: initialFooVersion,
			latestVersion: latestFooVersion,
			pendingRestart: true,
		});
		expect(initialFooVersion).not.toBe(latestFooVersion);
		const callsBeforePublic = clerk.state.requests;
		for (const path of [
			"/%5femdash/api/setup/status",
			"/%5femdash/api/setup/dev-bypass",
			"/%61dmin",
		]) {
			const denied = await request(port, "foo.localhost", path);
			expect(denied.status, path).toBe(421);
			expect(denied.body).not.toContain('"needsSetup"');
			expect(denied.body).not.toContain('"dev-bypass"');
		}
		expect((await request(port, "foo.localhost", "/%zz")).status).toBe(421);
		const unicodePublic = await request(port, "foo.localhost", "/caf%C3%A9");
		expect(unicodePublic.status).toBe(200);
		expect(unicodePublic.body).toContain("Unicode public route");
		const fooPublic = await request(port, "foo.localhost", "/");
		const barPublic = await request(port, "bar.localhost", "/");
		expect(fooPublic.body).toContain("Foo only marker");
		expect(fooPublic.body).not.toContain("Bar only marker");
		expect(fooPublic.body).toContain("Foo navigation marker");
		expect(fooPublic.body).not.toContain("Bar navigation marker");
		expect(barPublic.body).toContain("Bar only marker");
		expect(barPublic.body).not.toContain("Foo only marker");
		expect(barPublic.body).toContain("Bar navigation marker");
		expect(barPublic.body).not.toContain("Foo navigation marker");
		for (let visit = 0; visit < 2; visit++) {
			const fooCategory = await request(port, "foo.localhost", "/category/development");
			const barCategory = await request(port, "bar.localhost", "/category/development");
			expect(fooCategory.status).toBe(200);
			expect(barCategory.status).toBe(200);
			expect(fooCategory.body).toContain("Foo development");
			expect(fooCategory.body).not.toContain("Bar development");
			expect(barCategory.body).toContain("Bar development");
			expect(barCategory.body).not.toContain("Foo development");
		}
		expect(clerk.state.requests).toBe(callsBeforePublic);
		const sites = await request(port, "localhost", "/sites", cookie);
		expect(sites.status).toBe(200);
		expect(sites.body).toContain("System administration");
		expect((await request(port, "localhost", "/site/foo", cookie)).status).toBe(200);
		expect((await request(port, "localhost", "/site/bar", cookie)).status).toBe(200);
		expect(
			(
				await request(port, "localhost", "/admin", {
					...cookie,
					Cookie: `${cookie.Cookie}; emdash_last_site=foo`,
				})
			).headers.location,
		).toBe("/sites");
		expect((await request(port, "localhost", "/site/unknown", cookie)).status).toBe(404);
		expect((await request(port, "foo.localhost", "/_emdash/api/setup/status")).status).toBe(421);
		expect((await request(port, "unknown.localhost", "/")).status).toBe(421);
		expect(
			(await request(port, "foo.localhost", "/", { "X-Forwarded-Host": "bar.localhost" })).status,
		).toBe(421);
		const arabicSites = await request(port, "localhost", "/sites", {
			...cookie,
			"Accept-Language": "ar",
		});
		expect(arabicSites.body).toContain('dir="rtl"');

		clerk.state.superAdmin = false;
		expect((await request(port, "localhost", "/_emdash/api/system/sites", cookie)).status).toBe(
			403,
		);
		for (const path of ["/admin", "/sites", "/site/foo"]) {
			const denied = await request(port, "localhost", path, cookie);
			expect(denied.headers.location).toBe("/no-access");
		}
		expect((await request(port, "localhost", "/_emdash/admin/setup", cookie)).status).toBe(403);
		for (const path of ["/_emdash/api/setup/status", "/_emdash/api/manifest"]) {
			expect((await request(port, "localhost", path, cookie)).status).toBe(403);
		}
		const noAccess = await request(port, "localhost", "/no-access", cookie);
		expect(noAccess.status).toBe(200);
		expect(noAccess.body).toContain("No site access");
		expect(noAccess.body).not.toContain("foo");
		expect(noAccess.body).not.toContain("bar");
		expect((await request(port, "localhost", "/_emdash/api/setup/status", cookie)).status).toBe(
			403,
		);
		query("UPDATE _emdash_sites SET active = 0 WHERE slug = 'bar'");
		expect((await request(port, "bar.localhost", "/")).status).toBe(421);
		const { chromium } = await import("../../../node_modules/@playwright/test/index.mjs");
		const browser = await chromium.launch();
		try {
			const staffContext = await browser.newContext({ locale: "en" });
			await staffContext.addCookies([
				{ name: "__session", value: clerk.jwt(), url: `http://localhost:${port}` },
			]);
			const staffPage = await staffContext.newPage();
			await staffPage.goto(`http://localhost:${port}/admin`);
			await staffPage.getByRole("heading", { name: "No site access" }).waitFor();
			await staffPage.getByRole("button", { name: "Sign out" }).waitFor();
			if (process.env.EMDASH_CAPTURE_SETUP) {
				await staffPage.screenshot({ path: "/tmp/emdash-26-no-access.png", fullPage: true });
			}
			await staffContext.close();

			clerk.state.superAdmin = true;
			const adminContext = await browser.newContext({ locale: "ar" });
			await adminContext.addCookies([
				{ name: "__session", value: clerk.jwt(), url: `http://localhost:${port}` },
			]);
			const adminPage = await adminContext.newPage();
			await adminPage.goto(`http://localhost:${port}/admin`);
			await adminPage.getByRole("heading", { name: "Sites", exact: true }).waitFor();
			await adminPage.getByRole("button", { name: "Sign out" }).waitFor();
			expect(await adminPage.locator("html").getAttribute("dir")).toBe("rtl");
			await adminPage.getByRole("main").getByRole("link", { name: "foo" }).waitFor();
			await adminPage.getByRole("main").getByRole("link", { name: "bar" }).waitFor();
			const rtlLayout = await adminPage.evaluate(() => {
				const rtl = document.documentElement.dir === "rtl";
				const selectors = ["main > p", "main > h1", "main section h2", "main li > p"];
				const englishDirection = (text: string) => {
					const element = [...document.querySelectorAll("main bdi")].find(
						(item) => item.textContent?.trim() === text,
					);
					return element ? getComputedStyle(element).direction : undefined;
				};
				const misaligned = selectors.flatMap((selector) =>
					[...document.querySelectorAll(selector)].flatMap((element) => {
						const range = document.createRange();
						range.selectNodeContents(element);
						const rects = [...range.getClientRects()];
						if (rects.length === 0) return [];
						const firstTop = Math.min(...rects.map((rect) => rect.top));
						const firstLine = rects.filter((rect) => Math.abs(rect.top - firstTop) < 2);
						const lineStart = rtl
							? Math.max(...firstLine.map((rect) => rect.right))
							: Math.min(...firstLine.map((rect) => rect.left));
						const box = element.getBoundingClientRect();
						const boxStart = rtl ? box.right : box.left;
						const distance = Math.abs(lineStart - boxStart);
						if (distance <= 2) return [];
						const style = getComputedStyle(element);
						return [
							{
								selector,
								text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 100),
								direction: style.direction,
								textAlign: style.textAlign,
								lineStart,
								boxStart,
								distance,
							},
						];
					}),
				);
				return {
					direction: getComputedStyle(document.documentElement).direction,
					overflow: document.documentElement.scrollWidth > window.innerWidth,
					misaligned,
					proseDirections: {
						description: englishDirection("Manage the sites in this EmDash installation."),
						pendingRestart: englishDirection(
							"A restart is needed to load the latest presentation version.",
						),
						disabledExplanation: englishDirection(
							"This site is disabled. Its registration and data remain, but it is not available to visitors or site administrators.",
						),
					},
				};
			});
			if (process.env.EMDASH_CAPTURE_SETUP) {
				await adminPage.screenshot({ path: "/tmp/emdash-56-sites-ar.png", fullPage: true });
			}
			expect(rtlLayout).toEqual({
				direction: "rtl",
				overflow: false,
				misaligned: [],
				proseDirections: {
					description: "ltr",
					pendingRestart: "ltr",
					disabledExplanation: "ltr",
				},
			});
			await adminPage.getByRole("main").getByRole("link", { name: "foo" }).click();
			await adminPage.getByRole("heading", { name: "foo" }).waitFor();
			await adminPage.locator("main input").waitFor();
			const managementAlignment = await adminPage.evaluate(() => {
				const selectors = [
					"main > p",
					"main > h1",
					"main section > p",
					"main section h2",
					"main form > p",
				];
				return selectors.flatMap((selector) =>
					[...document.querySelectorAll(selector)].flatMap((element) => {
						const range = document.createRange();
						range.selectNodeContents(element);
						const rects = [...range.getClientRects()];
						if (rects.length === 0) return [];
						const firstTop = Math.min(...rects.map((rect) => rect.top));
						const firstLine = rects.filter((rect) => Math.abs(rect.top - firstTop) < 2);
						const lineStart = Math.max(...firstLine.map((rect) => rect.right));
						const box = element.getBoundingClientRect();
						const distance = Math.abs(lineStart - box.right);
						if (distance <= 2) return [];
						const style = getComputedStyle(element);
						return [
							{
								selector,
								text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 100),
								direction: style.direction,
								textAlign: style.textAlign,
								lineStart,
								boxStart: box.right,
								distance,
							},
						];
					}),
				);
			});
			if (process.env.EMDASH_CAPTURE_SETUP) {
				await adminPage.screenshot({
					path: "/tmp/emdash-56-site-management-ar.png",
					fullPage: true,
				});
			}
			expect(managementAlignment).toEqual([]);
			const openAdmin = adminPage.locator("main button:disabled");
			await openAdmin.waitFor();
			expect(await openAdmin.count()).toBeGreaterThan(0);
			expect(await adminPage.locator("main section").innerText()).toContain(
				"Site admin access is not available yet.",
			);
			await adminPage.goBack();
			await adminPage.getByRole("heading", { name: "Sites", exact: true }).waitFor();
			await adminPage.goForward();
			await adminPage.getByRole("heading", { name: "foo" }).waitFor();
			await adminContext.close();

			const editContext = await browser.newContext({ locale: "en" });
			await editContext.addCookies([
				{ name: "__session", value: clerk.jwt(), url: `http://localhost:${port}` },
			]);
			const firstEditor = await editContext.newPage();
			const secondEditor = await editContext.newPage();
			await firstEditor.goto(`http://localhost:${port}/sites`);
			await firstEditor.getByRole("main").getByRole("link", { name: "foo" }).waitFor();
			await firstEditor.getByRole("main").getByRole("link", { name: "bar" }).waitFor();
			expect(await firstEditor.locator("main").innerText()).toContain("Disabled");
			expect(await firstEditor.locator("main").innerText()).toContain("foo.localhost");
			expect(await firstEditor.locator("main").innerText()).toContain(
				"A restart is needed to load the latest presentation version.",
			);
			if (process.env.EMDASH_CAPTURE_SETUP) {
				await firstEditor.screenshot({ path: "/tmp/emdash-56-sites-en.png", fullPage: true });
			}
			await firstEditor.getByRole("main").getByRole("link", { name: "bar" }).click();
			await firstEditor.getByRole("heading", { name: "bar" }).waitFor();
			await firstEditor.getByLabel("Title").waitFor();
			expect(await firstEditor.locator("main").innerText()).toContain("Disabled");
			await firstEditor.goto(`http://localhost:${port}/sites`);
			await firstEditor.getByRole("main").getByRole("link", { name: "foo" }).waitFor();
			await firstEditor.getByRole("main").getByRole("link", { name: "foo" }).click();
			await firstEditor.getByLabel("Title").waitFor();
			if (process.env.EMDASH_CAPTURE_SETUP) {
				await firstEditor.screenshot({
					path: "/tmp/emdash-56-site-management-en.png",
					fullPage: true,
				});
			}
			await secondEditor.goto(`http://localhost:${port}/site/foo`);
			await secondEditor.getByLabel("Title").waitFor();
			await firstEditor.getByLabel("Title").fill("Foo title from first tab");
			const titleSave = firstEditor.waitForResponse(
				(response) =>
					response.url().endsWith("/_emdash/api/system/sites/foo") &&
					response.request().method() === "PATCH",
			);
			await firstEditor.getByRole("button", { name: "Save title" }).click();
			expect((await titleSave).status()).toBe(200);
			const fooSiteId = query("SELECT id FROM _emdash_sites WHERE slug = 'foo'");
			expect(query("SELECT value FROM options WHERE name = 'site:" + fooSiteId + ":title'")).toBe(
				'"Foo title from first tab"',
			);
			const audit = query(
				"SELECT timestamp || '|' || actor_id || '|' || resource_id || '|' || action || '|' || status || '|' || details FROM audit_logs WHERE resource_type = 'site' ORDER BY timestamp DESC LIMIT 1",
			).split("|");
			expect(audit[0]).toMatch(/^\d{4}-\d{2}-\d{2}/);
			expect(audit.slice(1).join("|")).toBe(
				`user_fixture|${fooSiteId}|settings_update|success|{"field":"title"}`,
			);
			expect(
				query(
					"SELECT value FROM options WHERE name = 'site:" +
						query("SELECT id FROM _emdash_sites WHERE slug = 'bar'") +
						":title'",
				),
			).not.toBe('"Foo title from first tab"');
			await firstEditor.getByLabel("Title").waitFor({ state: "visible" });
			expect(await firstEditor.getByLabel("Title").inputValue()).toBe("Foo title from first tab");
			await secondEditor.getByLabel("Title").fill("Stale title from second tab");
			await secondEditor.getByRole("button", { name: "Save title" }).click();
			const conflictAlert = secondEditor.getByRole("alert");
			await conflictAlert.waitFor({ state: "visible" });
			expect(await conflictAlert.innerText()).toContain("changed elsewhere");
			await secondEditor.getByRole("button", { name: "Reload latest" }).click();
			await secondEditor.getByLabel("Title").waitFor({ state: "visible" });
			expect(await secondEditor.getByLabel("Title").inputValue()).toBe("Foo title from first tab");
			await editContext.close();
		} finally {
			await browser.close();
		}
		expect((await request(port, "localhost", "/site/bar", cookie)).status).toBe(200);
		query("UPDATE _emdash_sites SET active = 1 WHERE slug = 'bar'");
		clerk.state.superAdmin = true;
		expect((await request(port, "localhost", "/no-access", cookie)).headers.location).toBe(
			"/sites",
		);
		clerk.state.active = false;
		expect((await request(port, "localhost", "/_emdash/api/system/sites", cookie)).status).toBe(
			401,
		);
		expect((await request(port, "localhost", "/admin", cookie)).headers.location).toContain(
			"/login?",
		);
		clerk.state.active = true;
		clerk.state.available = false;
		expect((await request(port, "localhost", "/admin", cookie)).status).toBe(503);
		clerk.state.available = true;
		expect((await request(port, "foo.localhost", "/")).status).toBe(200);
		const siteDataBeforeRecovery = query(
			"SELECT count(*) FROM ec_posts WHERE site_id = (SELECT id FROM _emdash_sites WHERE slug = 'foo')",
		);
		rmSync(resolve(project, "src/foo"), { recursive: true, force: true });
		addSite("foo");
		expect(existsSync(resolve(project, "src/foo/pages/index.astro"))).toBe(true);
		expect(
			query(
				"SELECT count(*) FROM ec_posts WHERE site_id = (SELECT id FROM _emdash_sites WHERE slug = 'foo')",
			),
		).toBe(siteDataBeforeRecovery);
		expect(
			query(
				"SELECT title FROM ec_posts WHERE site_id = (SELECT id FROM _emdash_sites WHERE slug = 'foo') AND slug = 'a-weekend-with-a-side-project'",
			),
		).toBe("Foo only marker");
		if (host && host.exitCode === null) {
			host.kill();
			await new Promise<void>((done) => host?.once("exit", () => done()));
		}
		startHost();
		await waitFor(
			async () => (await request(port, "foo.localhost", "/readiness-check")).status === 200,
		);
		const afterRestart = await requestHost("localhost", "/_emdash/api/system/sites/foo", cookie);
		expect(afterRestart.status).toBe(200);
		expect(JSON.parse(afterRestart.body).data.readiness).toMatchObject({
			status: "ready",
			loadedVersion: latestFooVersion,
			latestVersion: latestFooVersion,
			pendingRestart: false,
		});
		expect((await request(port, "foo.localhost", "/readiness-check")).body).toContain(
			"New foo presentation version",
		);
		completed = true;
		if (keep) writeFileSync(resolve(workspace, "postgres-container"), container);
	} finally {
		process.chdir(originalCwd);
		process.argv = originalArgv;
		vi.restoreAllMocks();
		host?.kill();
		await clerk?.close();
		if (!keep || !completed) {
			execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
			rmSync(workspace, { recursive: true, force: true });
		}
	}
}, 360_000);
