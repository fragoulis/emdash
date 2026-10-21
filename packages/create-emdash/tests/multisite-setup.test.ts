import { execFileSync, type ChildProcess } from "node:child_process";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { resolve } from "node:path";

import { expect, it } from "vitest";

import { createGeneratedHost, stopProcess } from "./generated-host-fixture.js";

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
	body?: string,
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
				let responseBody = "";
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => (responseBody += chunk));
				res.on("end", () =>
					done({ status: res.statusCode ?? 0, body: responseBody, headers: res.headers }),
				);
			},
		);
		req.setTimeout(15_000, () => req.destroy(new Error("request timed out")));
		req.on("error", (error) =>
			fail(new Error(`${method} ${hostname}${path}: ${error.message}`, { cause: error })),
		);
		req.end(body);
	});
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
	const keep = process.env.EMDASH_KEEP_INSTALL === "1";
	const fixture = await createGeneratedHost({
		workspace: keep
			? resolve(import.meta.dirname, "../../../templates/.astro/local-install")
			: undefined,
	});
	const { project, port, env, clerk, query, build, build: buildAsync } = fixture;
	let completed = false;
	let host!: ChildProcess;
	const startHost = () => {
		host = fixture.startHost();
	};
	try {
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
					`${String(error)}\\nHost exit code: ${host?.exitCode}\\nClerk fixture requests: ${clerkRequestsAtProbe} -> ${clerk?.state.requests ?? "unavailable"}\\nHost stdout:\\n${fixture.hostOutput}\\nHost stderr:\\n${fixture.hostErrorOutput}`,
					{ cause: error },
				);
			}
		};
		const cookie = { Cookie: `__session=${clerk.jwt()}` };
		writeFileSync(
			resolve(project, "src/default/pages/café.astro"),
			"<html><body>Unicode public route</body></html>",
		);
		await build();
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
		expect(fixture.hostOutput).toContain(`[host] Ready: admin http://localhost:${port}/admin`);
		expect(fixture.hostOutput).not.toContain("Public site: http://default.localhost");
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
		let fooCreationIdempotencyKey = "";
		let fooPublicAtCreation = "";
		const hostPidBeforeSiteCreation = host?.pid;
		const createSiteHttp = (title: string, slug: string, key: string) =>
			request(
				port,
				"localhost",
				"/_emdash/api/system/sites",
				{
					...cookie,
					Origin: `http://localhost:${port}`,
					"X-EmDash-Request": "1",
					"Idempotency-Key": key,
				},
				"POST",
				JSON.stringify({ title, slug }),
			);
		{
			const { chromium } = await import("../../../node_modules/@playwright/test/index.mjs");
			const browser = await chromium.launch();
			try {
				const context = await browser.newContext({
					locale: "en",
					viewport: { width: 1440, height: 900 },
				});
				await context.addCookies([
					{ name: "__session", value: clerk.jwt(), url: `http://localhost:${port}` },
				]);
				const page = await context.newPage();
				await page.goto(`http://localhost:${port}/sites`);
				await page.waitForFunction(() => {
					const islands = [...document.querySelectorAll("astro-island")];
					return islands.length > 0 && islands.every((island) => !island.hasAttribute("ssr"));
				});
				await page.getByLabel("Site title").fill("Acceptance Site");
				await page.getByLabel("Site slug").fill("foo");
				expect(await page.getByLabel("Site title").inputValue()).toBe("Acceptance Site");
				expect(await page.getByLabel("Site slug").inputValue()).toBe("foo");
				await page.waitForFunction(() => {
					const button = [...document.querySelectorAll("button")].find((item) =>
						item.textContent?.includes("Create site"),
					);
					return button && !button.disabled;
				});
				let interceptedCreation = false;
				await page.route("**/_emdash/api/system/sites", async (route) => {
					if (route.request().method() !== "POST" || interceptedCreation) return route.continue();
					interceptedCreation = true;
					const response = await route.fetch();
					expect(response.status()).toBe(201);
					await route.abort("connectionreset");
				});
				const createRequest = page.waitForRequest(
					(observedRequest) =>
						observedRequest.url().endsWith("/_emdash/api/system/sites") &&
						observedRequest.method() === "POST",
				);
				await page.getByRole("button", { name: "Create site" }).click();
				const postedCreate = await createRequest;
				const idempotencyKey = postedCreate.headers()["idempotency-key"];
				if (!idempotencyKey) throw new Error("Creation request did not include an idempotency key");
				fooCreationIdempotencyKey = idempotencyKey;
				await page.getByRole("alert").waitFor();
				expect(await page.getByLabel("Site title").inputValue()).toBe("Acceptance Site");
				expect(await page.getByLabel("Site slug").inputValue()).toBe("foo");
				const createdRecord = query("SELECT id FROM _emdash_sites WHERE slug = 'foo'");
				const postCountBeforeRetry = query("SELECT count(*) FROM ec_posts");
				const auditCountBeforeRetry = query(
					"SELECT count(*) FROM audit_logs WHERE resource_type = 'site' AND action = 'site_create'",
				);
				await page.reload();
				await page.waitForFunction(() => {
					const islands = [...document.querySelectorAll("astro-island")];
					return islands.length > 0 && islands.every((island) => !island.hasAttribute("ssr"));
				});
				expect(await page.getByLabel("Site title").inputValue()).toBe("Acceptance Site");
				expect(await page.getByLabel("Site slug").inputValue()).toBe("foo");
				const retryRequest = page.waitForRequest(
					(observedRequest) =>
						observedRequest.url().endsWith("/_emdash/api/system/sites") &&
						observedRequest.method() === "POST",
				);
				await page.getByRole("button", { name: "Create site" }).click();
				const retriedCreate = await retryRequest;
				expect(retriedCreate.headers()["idempotency-key"]).toBe(idempotencyKey);
				await page
					.getByRole("status")
					.filter({ hasText: "Site created and ready to serve." })
					.waitFor();
				expect(
					await page.evaluate(() => sessionStorage.getItem("emdash:system-site-create:v1")),
				).toBeNull();
				await page.unroute("**/_emdash/api/system/sites");
				expect(query("SELECT id FROM _emdash_sites WHERE slug = 'foo'")).toBe(createdRecord);
				expect(query("SELECT count(*) FROM ec_posts")).toBe(postCountBeforeRetry);
				expect(
					query(
						"SELECT count(*) FROM audit_logs WHERE resource_type = 'site' AND action = 'site_create'",
					),
				).toBe(auditCountBeforeRetry);
				const committedReplay = await request(
					port,
					"localhost",
					"/_emdash/api/system/sites",
					{
						...cookie,
						Origin: `http://localhost:${port}`,
						"X-EmDash-Request": "1",
						"Idempotency-Key": idempotencyKey,
					},
					"POST",
					JSON.stringify({ title: "Acceptance Site", slug: "foo" }),
				);
				expect(committedReplay.status).toBe(201);
				const conflictingReplay = await request(
					port,
					"localhost",
					"/_emdash/api/system/sites",
					{
						...cookie,
						Origin: `http://localhost:${port}`,
						"X-EmDash-Request": "1",
						"Idempotency-Key": idempotencyKey,
					},
					"POST",
					JSON.stringify({ title: "Changed input", slug: "other-slug" }),
				);
				expect(conflictingReplay.status).toBe(409);
				expect(query("SELECT count(*) FROM _emdash_sites WHERE slug = 'other-slug'")).toBe("0");
				await page.getByRole("link", { name: "Acceptance Site" }).waitFor();
				expect(await page.locator("main").innerText()).toContain("Ready");
				expect(await page.locator("main input").count()).toBe(2);
				expect(host?.pid).toBe(hostPidBeforeSiteCreation);
				if (process.env.EMDASH_CAPTURE_SETUP)
					await page.screenshot({ path: "/tmp/emdash-12-created-site-en.png", fullPage: true });
				await page.getByLabel("Site title").fill("Retained after error");
				await page.getByLabel("Site slug").fill("foo");
				await page.getByRole("button", { name: "Create site" }).click();
				await page.getByRole("alert").waitFor();
				expect(await page.getByLabel("Site title").inputValue()).toBe("Retained after error");
				expect(await page.getByLabel("Site slug").inputValue()).toBe("foo");
				const publicFoo = await request(port, "foo.localhost", "/");
				expect(publicFoo.status).toBe(200);
				expect(publicFoo.body).toContain("A Weekend with a Side Project");
				fooPublicAtCreation = publicFoo.body;
				await context.close();

				const arabicContext = await browser.newContext({
					locale: "ar",
					viewport: { width: 1440, height: 900 },
				});
				await arabicContext.addCookies([
					{ name: "__session", value: clerk.jwt(), url: `http://localhost:${port}` },
				]);
				const arabicPage = await arabicContext.newPage();
				await arabicPage.goto(`http://localhost:${port}/sites`);
				await arabicPage.getByRole("link", { name: "Acceptance Site" }).waitFor();
				expect(await arabicPage.locator("html").getAttribute("dir")).toBe("rtl");
				if (process.env.EMDASH_CAPTURE_SETUP)
					await arabicPage.screenshot({
						path: "/tmp/emdash-12-created-site-ar.png",
						fullPage: true,
					});
				await arabicContext.close();
			} finally {
				await browser.close();
			}
		}
		expect(addSite("bar")).toContain("Site bar registered and seeded");
		expect(addSite("bar")).toContain("Site bar registered and seeded");
		expect(host?.pid).toBe(hostPidBeforeSiteCreation);
		expect((await request(port, "foo.localhost", "/")).body).toBe(fooPublicAtCreation);
		const publicBar = await request(port, "bar.localhost", "/");
		expect(publicBar.status).toBe(200);
		expect(publicBar.body).toContain("A Weekend with a Side Project");
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
				(site: { readiness: { status: string }; presentation: string }) =>
					site.readiness.status === "ready" && site.presentation === "default",
			),
		).toBe(true);
		const immediatelyServed = await request(port, "foo.localhost", "/");
		expect(immediatelyServed.status).toBe(200);
		expect(immediatelyServed.body).toContain("A Weekend with a Side Project");
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
		const fooId = query("SELECT id FROM _emdash_sites WHERE slug = 'foo'");
		const fooPresentation = query("SELECT presentation FROM _emdash_sites WHERE slug = 'foo'");
		expect((await createSiteHttp("Acceptance Site", "foo", fooCreationIdempotencyKey)).status).toBe(
			201,
		);
		expect(query("SELECT id FROM _emdash_sites WHERE slug = 'foo'")).toBe(fooId);
		expect(query("SELECT presentation FROM _emdash_sites WHERE slug = 'foo'")).toBe(
			fooPresentation,
		);
		expect(query("SELECT count(*) FROM ec_posts")).toBe(beforeRetry);
		expect(query("SELECT count(*) FROM _emdash_collections")).toBe(collectionsBefore);
		expect(query("SELECT count(*) FROM _emdash_fields")).toBe(fieldsBefore);
		expect((await createSiteHttp("Occupied", "occupied", "occupied-create-http-01")).status).toBe(
			201,
		);
		expect(query("SELECT presentation FROM _emdash_sites WHERE slug = 'occupied'")).toBe("default");
		query(
			"INSERT INTO _emdash_site_hosts (hostname, site_id) SELECT 'taken.localhost', id FROM _emdash_sites WHERE slug = 'foo'",
		);
		expect((await createSiteHttp("Taken", "taken", "taken-create-http-001")).status).toBe(409);
		expect(query("SELECT count(*) FROM _emdash_sites WHERE slug = 'taken'")).toBe("0");
		query("DELETE FROM _emdash_site_hosts WHERE hostname = 'taken.localhost'");
		expect((await createSiteHttp("Default", "default", "default-create-http-01")).status).toBe(400);
		expect(query("SELECT count(*) FROM _emdash_sites WHERE slug = 'default'")).toBe("0");
		await build();
		await stopProcess(host);
		startHost();
		await waitFor(async () => (await request(port, "foo.localhost", "/")).status === 200);
		await waitFor(async () => (await request(port, "bar.localhost", "/")).status === 200);
		expect(query("SELECT count(*) FROM _emdash_sites")).toBe("3");
		expect((await request(port, "foo.localhost", "/readiness-check")).status).toBe(404);
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
		cpSync(resolve(project, "src/default"), resolve(project, "src/legacy"), { recursive: true });
		writeFileSync(
			resolve(project, "src/legacy/pages/readiness-check.astro"),
			"<html><body>Legacy presentation fixture</body></html>",
		);
		query("UPDATE _emdash_sites SET presentation = 'legacy' WHERE slug = 'bar'");
		await buildAsync();
		expect((await requestHost("bar.localhost", "/")).status).toBe(503);
		host.kill();
		await new Promise<void>((done) => host?.once("exit", () => done()));
		startHost();
		await waitFor(
			async () => (await requestHost("bar.localhost", "/readiness-check")).status === 200,
		);
		expect((await requestHost("bar.localhost", "/readiness-check")).body).toContain(
			"Legacy presentation fixture",
		);
		expect((await requestHost("foo.localhost", "/readiness-check")).status).toBe(404);
		expect((await requestHost("localhost", "/admin", cookie)).status).toBe(302);
		const loadedLegacyVersion = JSON.parse(
			readFileSync(resolve(project, "dist/sites/legacy/version.json"), "utf8"),
		).version;
		writeFileSync(
			resolve(project, "src/legacy/pages/readiness-check.astro"),
			"<html><body>Updated legacy presentation fixture</body></html>",
		);
		await buildAsync();
		const pendingLegacyVersion = JSON.parse(
			readFileSync(resolve(project, "dist/sites/legacy/version.json"), "utf8"),
		).version;
		expect(pendingLegacyVersion).not.toBe(loadedLegacyVersion);
		expect((await requestHost("bar.localhost", "/readiness-check")).body).toContain(
			"Legacy presentation fixture",
		);
		const pendingReadiness = await requestHost(
			"localhost",
			"/_emdash/api/system/sites/bar",
			cookie,
		);
		expect(JSON.parse(pendingReadiness.body).data.readiness).toMatchObject({
			status: "ready",
			loadedVersion: loadedLegacyVersion,
			latestVersion: pendingLegacyVersion,
			pendingRestart: true,
		});
		host.kill();
		await new Promise<void>((done) => host?.once("exit", () => done()));
		startHost();
		await waitFor(
			async () => (await requestHost("bar.localhost", "/readiness-check")).status === 200,
		);
		expect((await requestHost("bar.localhost", "/readiness-check")).body).toContain(
			"Updated legacy presentation fixture",
		);
		await waitFor(async () =>
			fixture.hostOutput.includes(`[host] Public site: http://bar.localhost:${port}`),
		);
		expect(fixture.hostOutput).toContain(`[host] Public site: http://foo.localhost:${port}`);
		expect(fixture.hostOutput).not.toContain("Public site: http://default.localhost");
		clerkRequestsAtProbe = clerk.state.requests;
		const readinessResponse = await requestHost(
			"localhost",
			"/_emdash/api/system/sites/bar",
			cookie,
		);
		expect(readinessResponse.status).toBe(200);
		expect(JSON.parse(readinessResponse.body).data.readiness).toMatchObject({
			status: "ready",
			loadedVersion: pendingLegacyVersion,
			latestVersion: pendingLegacyVersion,
			pendingRestart: false,
		});
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
		const unauthorizedCreate = await request(
			port,
			"localhost",
			"/_emdash/api/system/sites",
			{
				...cookie,
				Origin: `http://localhost:${port}`,
				"X-EmDash-Request": "1",
				"Idempotency-Key": "unauthorized-create",
			},
			"POST",
			JSON.stringify({ title: "Unauthorized", slug: "unauthorized" }),
		);
		expect(unauthorizedCreate.status).toBe(403);
		expect(query("SELECT count(*) FROM _emdash_sites WHERE slug = 'unauthorized'")).toBe("0");
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
			await adminPage.getByRole("main").getByRole("link", { name: "Acceptance Site" }).waitFor();
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
					pendingRestart: undefined,
					disabledExplanation: "ltr",
				},
			});
			await adminPage.getByRole("main").getByRole("link", { name: "Acceptance Site" }).click();
			await adminPage.getByRole("heading", { name: "foo" }).waitFor();
			await adminPage.waitForFunction(
				() => document.querySelectorAll("main form input").length === 1,
			);
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
			await firstEditor.getByRole("main").getByRole("link", { name: "Acceptance Site" }).waitFor();
			await firstEditor.getByRole("main").getByRole("link", { name: "bar" }).waitFor();
			expect(await firstEditor.locator("main").innerText()).toContain("Disabled");
			expect(await firstEditor.locator("main").innerText()).toContain("foo.localhost");
			if (process.env.EMDASH_CAPTURE_SETUP) {
				await firstEditor.screenshot({ path: "/tmp/emdash-56-sites-en.png", fullPage: true });
			}
			await firstEditor.getByRole("main").getByRole("link", { name: "bar" }).click();
			await firstEditor.getByRole("heading", { name: "bar" }).waitFor();
			await firstEditor.getByLabel("Title").waitFor();
			expect(await firstEditor.locator("main").innerText()).toContain("Disabled");
			await firstEditor.goto(`http://localhost:${port}/sites`);
			await firstEditor.getByRole("main").getByRole("link", { name: "Acceptance Site" }).waitFor();
			await firstEditor.getByRole("main").getByRole("link", { name: "Acceptance Site" }).click();
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
		const siteDataBeforeRetry = query(
			"SELECT count(*) FROM ec_posts WHERE site_id = (SELECT id FROM _emdash_sites WHERE slug = 'foo')",
		);
		expect((await createSiteHttp("Acceptance Site", "foo", fooCreationIdempotencyKey)).status).toBe(
			201,
		);
		expect(
			query(
				"SELECT count(*) FROM ec_posts WHERE site_id = (SELECT id FROM _emdash_sites WHERE slug = 'foo')",
			),
		).toBe(siteDataBeforeRetry);
		expect(
			query(
				"SELECT title FROM ec_posts WHERE site_id = (SELECT id FROM _emdash_sites WHERE slug = 'foo') AND slug = 'a-weekend-with-a-side-project'",
			),
		).toBe("Foo only marker");
		expect((await request(port, "foo.localhost", "/")).body).toContain("Foo only marker");
		expect((await request(port, "bar.localhost", "/readiness-check")).body).toContain(
			"Updated legacy presentation fixture",
		);
		completed = true;
	} finally {
		await fixture.close(keep && completed);
	}
}, 360_000);
