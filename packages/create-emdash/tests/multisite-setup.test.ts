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
		req.on("error", fail);
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
		let hostOutput = "";
		const startHost = () => {
			hostOutput = "";
			host = spawn(process.execPath, [resolve(project, "host.mjs")], {
				cwd: project,
				env,
				stdio: ["ignore", "pipe", "pipe"],
			});
			host.stdout?.setEncoding("utf8").on("data", (chunk) => (hostOutput += chunk));
			host.stderr?.on("data", (chunk) => console.error("[fixture host]", String(chunk)));
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
		const callsBeforePublic = clerk.state.requests;
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
			expect(fooCategory.body).toContain("Foo development");
			expect(fooCategory.body).not.toContain("Bar development");
			expect(barCategory.body).toContain("Bar development");
			expect(barCategory.body).not.toContain("Foo development");
		}
		expect(clerk.state.requests).toBe(callsBeforePublic);
		const sites = await request(port, "localhost", "/sites", cookie);
		expect(sites.status).toBe(200);
		expect(sites.body).toContain("foo");
		expect(sites.body).toContain("bar");
		expect(sites.body).not.toContain('href="/site/default"');
		expect((await request(port, "localhost", "/site/foo", cookie)).body).toContain("foo");
		expect((await request(port, "localhost", "/site/bar", cookie)).body).toContain("bar");
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
			if (process.env.EMDASH_CAPTURE_SETUP) {
				await adminPage.screenshot({ path: "/tmp/emdash-26-sites-ar.png", fullPage: true });
			}
			await adminPage.getByRole("main").getByRole("link", { name: "foo" }).click();
			await adminPage.getByRole("heading", { name: "foo" }).waitFor();
			await adminPage.goBack();
			await adminPage.getByRole("heading", { name: "Sites", exact: true }).waitFor();
			await adminPage.goForward();
			await adminPage.getByRole("heading", { name: "foo" }).waitFor();
			await adminContext.close();
		} finally {
			await browser.close();
		}
		query("UPDATE _emdash_sites SET active = 0 WHERE slug = 'bar'");
		expect((await request(port, "bar.localhost", "/")).status).toBe(421);
		expect((await request(port, "localhost", "/site/bar", cookie)).status).toBe(404);
		query("UPDATE _emdash_sites SET active = 1 WHERE slug = 'bar'");
		clerk.state.superAdmin = true;
		expect((await request(port, "localhost", "/no-access", cookie)).headers.location).toBe(
			"/sites",
		);
		clerk.state.active = false;
		expect((await request(port, "localhost", "/admin", cookie)).headers.location).toContain(
			"/login?",
		);
		clerk.state.active = true;
		clerk.state.available = false;
		expect((await request(port, "localhost", "/admin", cookie)).status).toBe(503);
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
