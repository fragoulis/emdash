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

function request(
	port: number,
	hostname: string,
	path: string,
	headers: Record<string, string> = {},
	body?: object,
) {
	return new Promise<{
		status: number;
		body: string;
		headers: import("node:http").IncomingHttpHeaders;
	}>((done, fail) => {
		const payload = body && JSON.stringify(body);
		const req = httpRequest(
			{
				hostname: "127.0.0.1",
				port,
				path,
				method: body ? "POST" : "GET",
				headers: {
					Host: `${hostname}:${port}`,
					...headers,
					...(payload ? { "Content-Type": "application/json" } : {}),
				},
			},
			(res) => {
				let text = "";
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => (text += chunk));
				res.on("end", () =>
					done({ status: res.statusCode ?? 0, body: text, headers: res.headers }),
				);
			},
		);
		req.on("error", fail);
		req.end(payload);
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
	for (let i = 0; i < 120; i++) {
		try {
			if (await check()) return;
		} catch {
			// The host may still be starting.
		}
		await new Promise((done) => setTimeout(done, 100));
	}
	throw new Error("Installation did not become ready");
}

it("sets up a generated site through Clerk and renders the default site", async () => {
	const workdir = resolve(template, "../.astro");
	mkdirSync(workdir, { recursive: true });
	const keep = process.env.EMDASH_KEEP_INSTALL === "1";
	const workspace = keep
		? resolve(workdir, "local-install")
		: mkdtempSync(resolve(workdir, "install-test-"));
	if (keep) mkdirSync(workspace, { recursive: true });
	const project = resolve(workspace, "site");
	if (keep && existsSync(project)) throw new Error("Reset the existing local installation first");
	let completed = false;
	const originalCwd = process.cwd();
	const originalArgv = process.argv;
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
	let host: ChildProcess | undefined;
	let clerk: Awaited<ReturnType<typeof startClerkFixture>> | undefined;
	try {
		const mapping = execFileSync("docker", ["port", container, "5432"], { encoding: "utf8" });
		const pgPort = Number(mapping.match(/127\.0\.0\.1:(\d+)/)?.[1]);
		if (!pgPort) throw new Error("Missing PostgreSQL port");
		await waitFor(async () => {
			try {
				execFileSync(
					"docker",
					["exec", container, "psql", "-U", "postgres", "-d", "test", "-c", "SELECT 1"],
					{ stdio: "ignore" },
				);
				return true;
			} catch {
				return false;
			}
		});
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
		await vi.waitFor(() => expect(existsSync(resolve(project, ".env"))).toBe(true));
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
			CLERK_BOOTSTRAP_USER_ID: "user_fixture",
			CLERK_JWT_KEY: clerk.publicKey,
			EMDASH_CLERK_API_URL: clerk.url,
			PORT: String(port),
		};
		execFileSync(process.execPath, [resolve(project, "build.mjs")], {
			cwd: project,
			env,
			timeout: 120_000,
			stdio: "pipe",
		});
		host = spawn(process.execPath, [resolve(project, "host.mjs")], {
			cwd: project,
			env,
			stdio: ["ignore", "ignore", "pipe"],
		});
		host.stderr?.on("data", (chunk) => console.error("[fixture host]", String(chunk)));
		await waitFor(async () => (await request(port, "localhost", "/admin")).status === 302);
		const login = await request(port, "localhost", "/clerk-login");
		expect(login.status).toBe(200);
		expect(login.body).toContain("Sign in to EmDash");
		const arabicLogin = await request(port, "localhost", "/clerk-login", {
			"Accept-Language": "ar",
		});
		expect(arabicLogin.body).toContain('dir="rtl"');
		expect((await request(port, "default.localhost", "/clerk-login")).status).toBe(421);
		const cli = resolve(import.meta.dirname, "../dist/index.mjs");
		const siteCommand = (slug: string) =>
			execFileSync(process.execPath, [cli, "site", slug], {
				cwd: project,
				env,
				encoding: "utf8",
				timeout: 30_000,
			});
		expect(() => siteCommand("foo")).toThrow("Complete initial setup");
		expect(existsSync(resolve(project, "src/foo"))).toBe(false);
		const cookie = { Cookie: `__session=${clerk.jwt()}` };
		const status = await request(port, "localhost", "/_emdash/api/setup/status", cookie);
		expect(status.status).toBe(200);
		if (process.env.EMDASH_CAPTURE_SETUP) {
			const { chromium } = await import("../../../node_modules/@playwright/test/index.mjs");
			const browser = await chromium.launch();
			try {
				for (const locale of ["en", "ar"] as const) {
					const context = await browser.newContext({ locale });
					await context.addCookies([
						{ name: "__session", value: clerk.jwt(), url: `http://localhost:${port}` },
					]);
					const page = await context.newPage();
					await page.goto(`http://localhost:${port}/_emdash/admin/setup`);
					await page.getByRole("heading", { level: 1 }).waitFor();
					await page.screenshot({ path: `/tmp/emdash-21-setup-${locale}.png`, fullPage: true });
					await context.close();
				}
			} finally {
				await browser.close();
			}
		}
		await waitFor(async () => (await request(port, "default.localhost", "/")).status === 200);
		let setupResult;
		for (let i = 0; i < 12; i++) {
			const setup = await request(
				port,
				"localhost",
				"/_emdash/api/setup",
				{
					...cookie,
					Origin: `http://localhost:${port}`,
					"X-EmDash-Request": "1",
				},
				{ title: "Sample Blog", tagline: "Default site", includeContent: true },
			);
			expect(setup.status).toBe(200);
			setupResult = JSON.parse(setup.body);
			if (setupResult.data?.seedComplete) break;
		}
		expect(setupResult).toMatchObject({ data: { setupComplete: true, seedComplete: true } });
		const oneSite = await request(port, "localhost", "/admin", cookie);
		expect(oneSite.headers.location).toBe("/site/default");
		expect((await request(port, "localhost", "/site/default", cookie)).body).toContain("default");
		expect((await request(port, "localhost", "/site/unknown", cookie)).status).toBe(404);
		expect((await request(port, "default.localhost", "/site/default", cookie)).status).toBe(421);
		expect(await request(port, "localhost", "/_emdash/api/manifest", cookie)).toMatchObject({
			status: 401,
		});
		const page = await request(port, "default.localhost", "/");
		expect(page.status).toBe(200);
		expect(page.body).toContain("Sample Blog");
		expect(page.body).toContain("A Weekend with a Side Project");
		{
			const query = (sql: string) =>
				execFileSync(
					"docker",
					["exec", container, "psql", "-U", "postgres", "-d", "test", "-t", "-A", "-c", sql],
					{ encoding: "utf8" },
				).trim();
			const collectionsBefore = query("SELECT count(*) FROM _emdash_collections");
			const fieldsBefore = query("SELECT count(*) FROM _emdash_fields");
			const defaultPosts = query("SELECT count(*) FROM ec_posts WHERE site_id = 'site-default'");
			expect(siteCommand("foo")).toContain("Site foo registered");
			const seeded = query(
				"SELECT (SELECT count(*) FROM ec_posts WHERE site_id = s.id), (SELECT count(*) FROM taxonomies WHERE site_id = s.id), (SELECT count(*) FROM _emdash_bylines WHERE site_id = s.id), (SELECT count(*) FROM _emdash_menus WHERE site_id = s.id), (SELECT count(*) FROM options WHERE site_id = s.id) FROM _emdash_sites s WHERE slug = 'foo'",
			);
			expect(
				seeded
					.split("|")
					.map(Number)
					.every((count) => count > 0),
			).toBe(true);
			expect(query("SELECT count(*) FROM _emdash_collections")).toBe(collectionsBefore);
			expect(query("SELECT count(*) FROM _emdash_fields")).toBe(fieldsBefore);
			expect(query("SELECT count(*) FROM ec_posts WHERE site_id = 'site-default'")).toBe(
				defaultPosts,
			);
			const home = resolve(project, "src/foo/pages/index.astro");
			const edited = `${readFileSync(home, "utf8")}\n<p>Edited presentation marker</p>\n`;
			writeFileSync(home, edited);
			siteCommand("foo");
			expect(readFileSync(home, "utf8")).toBe(edited);
			const siteRows = execFileSync(
				"docker",
				[
					"exec",
					container,
					"psql",
					"-U",
					"postgres",
					"-d",
					"test",
					"-t",
					"-A",
					"-c",
					"SELECT count(*), count(DISTINCT id) FROM _emdash_sites WHERE slug = 'foo'",
				],
				{ encoding: "utf8" },
			);
			expect(siteRows.trim()).toBe("1|1");
			const entries = execFileSync(
				"docker",
				[
					"exec",
					container,
					"psql",
					"-U",
					"postgres",
					"-d",
					"test",
					"-t",
					"-A",
					"-c",
					"SELECT count(*) FROM ec_posts WHERE site_id = (SELECT id FROM _emdash_sites WHERE slug = 'foo')",
				],
				{ encoding: "utf8" },
			);
			expect(Number(entries.trim())).toBeGreaterThan(0);
			expect(
				query(
					"SELECT (SELECT count(*) FROM ec_posts WHERE site_id = s.id), (SELECT count(*) FROM taxonomies WHERE site_id = s.id), (SELECT count(*) FROM _emdash_bylines WHERE site_id = s.id), (SELECT count(*) FROM _emdash_menus WHERE site_id = s.id), (SELECT count(*) FROM options WHERE site_id = s.id) FROM _emdash_sites s WHERE slug = 'foo'",
				),
			).toBe(seeded);
			query(
				"UPDATE ec_posts SET title = 'Foo site only story' WHERE site_id = (SELECT id FROM _emdash_sites WHERE slug = 'foo') AND slug = 'a-weekend-with-a-side-project'",
			);
			query(
				"UPDATE _emdash_menu_items SET label = 'Foo site navigation' WHERE site_id = (SELECT id FROM _emdash_sites WHERE slug = 'foo') AND label = 'About'",
			);
			mkdirSync(resolve(project, "src/occupied"));
			expect(() => siteCommand("occupied")).toThrow(
				"conflicts with an existing hostname or presentation",
			);
			expect(query("SELECT count(*) FROM _emdash_sites WHERE slug = 'occupied'")).toBe("0");
			rmSync(resolve(project, "src/occupied"), { recursive: true });
			expect(() => siteCommand("default")).toThrow("unique lowercase slug");
		}
		host.kill();
		await new Promise<void>((done) => host?.once("exit", () => done()));
		execFileSync(process.execPath, [resolve(project, "build.mjs")], {
			cwd: project,
			env,
			timeout: 180_000,
			stdio: "pipe",
		});
		host = spawn(process.execPath, [resolve(project, "host.mjs")], {
			cwd: project,
			env,
			stdio: ["ignore", "ignore", "pipe"],
		});
		host.stderr?.on("data", (chunk) => console.error("[fixture host]", String(chunk)));
		await waitFor(async () => (await request(port, "foo.localhost", "/")).status === 200);
		const foo = await request(port, "foo.localhost", "/");
		expect(foo.body).toContain("Foo site only story");
		expect(foo.body).toContain("Edited presentation marker");
		expect(foo.body).toContain("Foo site navigation");
		expect(foo.body).not.toContain("A Weekend with a Side Project");
		expect(foo.body).toContain("foo");
		const defaultPage = await request(port, "default.localhost", "/");
		expect(defaultPage.status).toBe(200);
		expect(defaultPage.body).toContain("Sample Blog");
		expect(defaultPage.body).toContain("A Weekend with a Side Project");
		expect(defaultPage.body).not.toContain("Foo site only story");
		expect(defaultPage.body).not.toContain("Edited presentation marker");
		expect(defaultPage.body).not.toContain("Foo site navigation");
		const fooCategory = await request(port, "foo.localhost", "/category/development");
		expect(fooCategory.status).toBe(200);
		expect(fooCategory.body).toContain("Foo site only story");
		const defaultCategory = await request(port, "default.localhost", "/category/development");
		expect(defaultCategory.status).toBe(200);
		expect(defaultCategory.body).toContain("A Weekend with a Side Project");
		expect(defaultCategory.body).not.toContain("Foo site only story");
		const countPosts = () =>
			execFileSync(
				"docker",
				[
					"exec",
					container,
					"psql",
					"-U",
					"postgres",
					"-d",
					"test",
					"-t",
					"-A",
					"-c",
					"SELECT count(*) FROM ec_posts WHERE site_id = (SELECT id FROM _emdash_sites WHERE slug = 'foo')",
				],
				{ encoding: "utf8" },
			).trim();
		const countBeforeRecovery = countPosts();
		rmSync(resolve(project, "src/foo"), { recursive: true });
		siteCommand("foo");
		expect(existsSync(resolve(project, "src/foo/pages/index.astro"))).toBe(true);
		expect(readFileSync(resolve(project, "src/foo/pages/index.astro"), "utf8")).not.toContain(
			"Edited presentation marker",
		);
		expect(countPosts()).toBe(countBeforeRecovery);
		expect(Number(countBeforeRecovery)).toBeGreaterThan(0);
		expect(
			execFileSync(
				"docker",
				[
					"exec",
					container,
					"psql",
					"-U",
					"postgres",
					"-d",
					"test",
					"-t",
					"-A",
					"-c",
					"SELECT title FROM ec_posts WHERE site_id = (SELECT id FROM _emdash_sites WHERE slug = 'foo') AND slug = 'a-weekend-with-a-side-project'",
				],
				{ encoding: "utf8" },
			).trim(),
		).toBe("Foo site only story");
		expect((await request(port, "unknown.localhost", "/")).status).toBe(421);
		expect(
			(await request(port, "foo.localhost", "/", { "X-Forwarded-Host": "default.localhost" }))
				.status,
		).toBe(421);
		expect((await request(port, "localhost", "/admin", cookie)).headers.location).toBe("/sites");
		const sites = await request(port, "localhost", "/sites", cookie);
		expect(sites.status).toBe(200);
		expect(sites.body).toContain("/site/foo");
		expect(sites.body).toContain("/site/default");
		const arabicSites = await request(port, "localhost", "/sites", {
			...cookie,
			"Accept-Language": "ar",
		});
		expect(arabicSites.body).toContain('dir="rtl"');
		const selected = await request(port, "localhost", "/site/foo", cookie);
		expect(selected.status).toBe(200);
		expect(selected.headers["set-cookie"]?.[0]).toContain("emdash_last_site=foo");
		expect(
			(
				await request(port, "localhost", "/admin", {
					...cookie,
					Cookie: cookie.Cookie + "; emdash_last_site=foo",
				})
			).headers.location,
		).toBe("/site/foo");
		const { chromium } = await import("../../../node_modules/@playwright/test/index.mjs");
		const browser = await chromium.launch();
		try {
			const context = await browser.newContext({ locale: "ar" });
			await context.addCookies([
				{ name: "__session", value: clerk.jwt(), url: `http://localhost:${port}` },
			]);
			const browserPage = await context.newPage();
			await browserPage.goto(`http://localhost:${port}/admin`);
			await browserPage.getByRole("heading", { name: "Sites" }).waitFor();
			expect(await browserPage.locator("html").getAttribute("dir")).toBe("rtl");
			await browserPage.screenshot({ path: "/tmp/emdash-10-sites-ar.png", fullPage: true });
			await browserPage.getByRole("main").getByRole("link", { name: "foo" }).click();
			await browserPage.getByRole("heading", { name: "foo" }).waitFor();
			await browserPage.goBack();
			await browserPage.getByRole("heading", { name: "Sites" }).waitFor();
			await browserPage.goForward();
			await browserPage.getByRole("heading", { name: "foo" }).waitFor();
			await context.close();
		} finally {
			await browser.close();
		}
		clerk.state.superAdmin = false;
		expect((await request(port, "localhost", "/site/foo", cookie)).status).toBe(302);
		clerk.state.superAdmin = true;
		clerk.state.available = false;
		expect((await request(port, "localhost", "/site/foo", cookie)).status).toBe(503);
		clerk.state.available = true;
		const updateSite = (sql: string) =>
			execFileSync("docker", [
				"exec",
				container,
				"psql",
				"-U",
				"postgres",
				"-d",
				"test",
				"-c",
				sql,
			]);
		updateSite("UPDATE _emdash_sites SET active = 0 WHERE slug = 'foo'");
		expect((await request(port, "localhost", "/site/foo", cookie)).status).toBe(404);
		expect(
			(
				await request(port, "localhost", "/admin", {
					Cookie: cookie.Cookie + "; emdash_last_site=foo",
				})
			).headers.location,
		).toBe("/site/default");
		updateSite("UPDATE _emdash_sites SET active = 0 WHERE slug = 'default'");
		expect((await request(port, "localhost", "/admin", cookie)).headers.location).toBe("/sites");
		expect((await request(port, "localhost", "/sites", cookie)).body).toContain("No site access");
		updateSite("UPDATE _emdash_sites SET active = 1");
		const user = execFileSync(
			"docker",
			[
				"exec",
				container,
				"psql",
				"-U",
				"postgres",
				"-d",
				"test",
				"-t",
				"-A",
				"-c",
				"SELECT a.provider_account_id FROM users u JOIN oauth_accounts a ON a.user_id = u.id WHERE a.provider = 'clerk' AND u.role = 50",
			],
			{ encoding: "utf8" },
		);
		expect(user.trim()).toBe("user_fixture");
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
