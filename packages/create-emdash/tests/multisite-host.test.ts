import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { prepareDefaultPresentation } from "../src/multisite.js";
import { startClerkFixture } from "./clerk-fixture.js";
import { linkScaffoldDependencies } from "./scaffold-dependencies.js";

const template = resolve(import.meta.dirname, "../../../templates/blog");

async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Expected a TCP address");
	await new Promise<void>((ready) => server.close(() => ready()));
	return address.port;
}

function get(
	port: number,
	host: string,
	path = "/",
	headers: Record<string, string> = {},
	method = "GET",
	payload?: string,
) {
	return new Promise<{ status: number; body: string; location?: string }>((done, fail) => {
		const request = httpRequest(
			{
				hostname: "127.0.0.1",
				port,
				path,
				method,
				headers: { Host: `${host}:${port}`, ...headers },
			},
			(response) => {
				let body = "";
				response.setEncoding("utf8");
				response.on("data", (chunk: string) => (body += chunk));
				response.on("end", () =>
					done({ status: response.statusCode ?? 0, body, location: response.headers.location }),
				);
			},
		);
		request.on("error", fail);
		request.end(payload);
	});
}

async function waitForResponse(
	port: number,
	host: string,
	expected: number,
	path = "/",
	headers: Record<string, string> = {},
): Promise<void> {
	for (let i = 0; i < 150; i++) {
		try {
			if ((await get(port, host, path, headers)).status === expected) return;
		} catch {
			// The host can still be initializing.
		}
		await new Promise((done) => setTimeout(done, 100));
	}
	throw new Error(`Generated host did not return ${expected} for ${host}${path}`);
}

describe("generated host", () => {
	it("enforces host and proxy boundaries against a real initialized PostgreSQL schema", async () => {
		const project = mkdtempSync(join(tmpdir(), "emdash-host-"));
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
		let customHost: ChildProcess | undefined;
		let proxyHost: ChildProcess | undefined;
		let clerk: Awaited<ReturnType<typeof startClerkFixture>> | undefined;
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

			cpSync(join(template, "src"), join(project, "src"), { recursive: true });
			cpSync(join(template, "seed"), join(project, "seed"), { recursive: true });
			cpSync(join(template, "astro.config.mjs"), join(project, "astro.config.mjs"));
			prepareDefaultPresentation(project);
			linkScaffoldDependencies(project);
			for (const slug of ["default", "foo"]) {
				mkdirSync(join(project, "dist/sites", slug, "server"), { recursive: true });
			}
			const defaultEntry =
				'import { getRequestContext } from "emdash/request-context";\n' +
				'export function handler(request, response) { if (request.url === "/explode") throw new Error("Fixture failure"); response.end(getRequestContext()?.siteId ?? "none"); }\n';
			writeFileSync(join(project, "dist/sites/default/server/entry.mjs"), defaultEntry);
			writeFileSync(
				join(project, "dist/sites/default/version.json"),
				JSON.stringify({
					version: createHash("sha256")
						.update("server/entry.mjs")
						.update(defaultEntry)
						.digest("hex"),
				}),
			);
			const fooEntry =
				'import { getRequestContext } from "emdash/request-context";\n' +
				'export function handler(request, response) { if (request.url === "/explode") throw new Error("Fixture failure"); response.end("foo:" + getRequestContext()?.siteId); }\n';
			writeFileSync(join(project, "dist/sites/foo/server/entry.mjs"), fooEntry);
			writeFileSync(
				join(project, "dist/sites/foo/version.json"),
				JSON.stringify({
					version: createHash("sha256").update("server/entry.mjs").update(fooEntry).digest("hex"),
				}),
			);
			const hostPort = await freePort();
			clerk = await startClerkFixture(`http://localhost:${hostPort}`);
			const databaseUrl = `postgres://postgres:${password}@127.0.0.1:${pgPort}/test`;
			const clerkEnv = {
				NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerk.publishableKey,
				CLERK_SECRET_KEY: "sk_test_fixture",
				CLERK_BOOTSTRAP_USER_ID: "user_other_than_verified_admin",
				CLERK_JWT_KEY: clerk.publicKey,
				EMDASH_CLERK_API_URL: clerk.url,
			};
			const cookie = { Cookie: `__session=${clerk.jwt()}` };
			const env = {
				PATH: process.env.PATH,
				DATABASE_URL: databaseUrl,
				PORT: String(hostPort),
				...clerkEnv,
			};
			host = spawn(process.execPath, [join(project, "host.mjs")], {
				cwd: project,
				stdio: ["ignore", "ignore", "pipe"],
				env,
			});
			let hostError = "";
			host.stderr?.setEncoding("utf8").on("data", (chunk: string) => (hostError += chunk));
			try {
				await waitForResponse(hostPort, "localhost", 302, "/admin");
			} catch (error) {
				throw new Error(`${String(error)}\n${hostError}`, { cause: error });
			}
			expect(await get(hostPort, "localhost", "/admin", cookie)).toMatchObject({
				status: 302,
				location: "/sites",
			});
			expect(
				await get(hostPort, "localhost", "/_emdash/api/system/sites", {}, "GET"),
			).toMatchObject({ status: 401 });
			expect(
				await get(hostPort, "foo.localhost", "/_emdash/api/system/sites", cookie),
			).toMatchObject({ status: 421 });
			expect(
				await get(hostPort, "localhost", "/login?redirect=https%3A%2F%2Fevil.example"),
			).toMatchObject({ status: 302, location: "/login?redirect=%2Fadmin" });
			expect(await get(hostPort, "localhost", "/login?redirect=%2Fsite%2Ffoo")).toMatchObject({
				status: 200,
			});
			expect(await get(hostPort, "default.localhost")).toMatchObject({ status: 421 });
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
						"SELECT count(*) FROM _emdash_sites",
					],
					{ encoding: "utf8" },
				).trim(),
			).toBe("0");

			const addSites =
				"INSERT INTO _emdash_sites (id, slug, active) VALUES ('site-foo', 'foo', 1), ('site-unbuilt', 'unbuilt', 1); " +
				"INSERT INTO _emdash_site_hosts (hostname, site_id) VALUES ('foo.localhost', 'site-foo'), ('unbuilt.localhost', 'site-unbuilt')";
			execFileSync("docker", [
				"exec",
				container,
				"psql",
				"-U",
				"postgres",
				"-d",
				"test",
				"-c",
				addSites,
			]);
			await waitForResponse(hostPort, "foo.localhost", 200, "/_astro/example.js");
			expect(await get(hostPort, "foo.localhost")).toMatchObject({
				status: 200,
				body: "foo:site-foo",
			});
			expect(await get(hostPort, "foo.localhost", "/explode")).toMatchObject({ status: 500 });
			expect(await get(hostPort, "foo.localhost", "/_astro/example.js")).toMatchObject({
				status: 200,
				body: "foo:site-foo",
			});
			expect(await get(hostPort, "foo.localhost", "/_emdash/api/search")).toMatchObject({
				status: 200,
				body: "foo:site-foo",
			});
			expect(await get(hostPort, "foo.localhost", "/_emdash/admin")).toMatchObject({ status: 421 });
			expect(await get(hostPort, "foo.localhost", "/no-access")).toMatchObject({ status: 421 });
			expect(await get(hostPort, "foo.localhost", "/_emdash/api/setup/status")).toMatchObject({
				status: 421,
			});
			expect(await get(hostPort, "foo.localhost", "/%2e%2e/_emdash/admin")).toMatchObject({
				status: 421,
			});
			expect(await get(hostPort, "foo.localhost", "/_emdash/api/setup%2fstatus")).toMatchObject({
				status: 421,
			});
			expect(await get(hostPort, "localhost", "/")).toMatchObject({
				status: 302,
				location: "/login?redirect=%2Fadmin",
			});
			expect(await get(hostPort, "localhost", "/_emdash/admin/setup", cookie)).toMatchObject({
				status: 403,
			});
			expect(await get(hostPort, "localhost", "/no-access", cookie)).toMatchObject({
				status: 302,
				location: "/sites",
			});
			const apiCookie = {
				Cookie: `__session=${clerk.jwt()}`,
				Origin: `http://localhost:${hostPort}`,
			};
			const listed = await get(hostPort, "localhost", "/_emdash/api/system/sites", apiCookie);
			expect(listed.status).toBe(200);
			expect(JSON.parse(listed.body).data.items.map((site: { slug: string }) => site.slug)).toEqual(
				["foo", "unbuilt"],
			);
			const detail = await get(
				hostPort,
				"localhost",
				"/_emdash/api/system/sites/unbuilt",
				apiCookie,
			);
			expect(JSON.parse(detail.body).data.readiness).toMatchObject({ status: "unavailable" });
			const badCsrf = await get(
				hostPort,
				"localhost",
				"/_emdash/api/system/sites/foo",
				{ Cookie: apiCookie.Cookie },
				"PATCH",
				JSON.stringify({ title: "Changed", expectedRevision: null }),
			);
			expect(badCsrf.status).toBe(403);
			const badOrigin = await get(
				hostPort,
				"localhost",
				"/_emdash/api/system/sites/foo",
				{ ...apiCookie, Origin: "https://attacker.example" },
				"PATCH",
				JSON.stringify({ title: "Changed", expectedRevision: null }),
			);
			expect(badOrigin.status).toBe(403);
			const invalidJson = await get(
				hostPort,
				"localhost",
				"/_emdash/api/system/sites/foo",
				{ ...apiCookie, "X-EmDash-Request": "1" },
				"PATCH",
				"{",
			);
			expect(invalidJson.status).toBe(400);
			const oversized = await get(
				hostPort,
				"localhost",
				"/_emdash/api/system/sites/foo",
				{ ...apiCookie, "X-EmDash-Request": "1" },
				"PATCH",
				"x".repeat(4097),
			);
			expect(oversized.status).toBe(413);
			const patchHeaders = {
				...apiCookie,
				"X-EmDash-Request": "1",
				"Content-Type": "application/json",
			};
			const concurrent = await Promise.all(
				["Foo title A", "Foo title B"].map((title) =>
					get(
						hostPort,
						"localhost",
						"/_emdash/api/system/sites/foo",
						patchHeaders,
						"PATCH",
						JSON.stringify({ title, expectedRevision: null }),
					),
				),
			);
			expect(concurrent.map((result) => result.status).toSorted((a, b) => a - b)).toEqual([200, 409]);
			const changed = concurrent.find((result) => result.status === 200)!;
			expect(["Foo title A", "Foo title B"]).toContain(JSON.parse(changed.body).data.title);
			const audit = execFileSync(
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
					"SELECT actor_id || ':' || resource_id || ':' || (timestamp IS NOT NULL)::text || ':' || count(*) OVER () FROM audit_logs WHERE action = 'settings_update' AND resource_type = 'site' AND status = 'success'",
				],
				{ encoding: "utf8" },
			).trim();
			expect(audit).toContain("user_fixture:site-foo:true:1");
			expect(
				JSON.parse(
					(await get(hostPort, "localhost", "/_emdash/api/system/sites/unbuilt", apiCookie)).body,
				).data.title,
			).toBeNull();
			clerk.state.superAdmin = false;
			const revokedAuthority = await get(
				hostPort,
				"localhost",
				"/_emdash/api/system/sites",
				apiCookie,
			);
			expect(revokedAuthority.status).toBe(403);
			clerk.state.superAdmin = true;
			expect(
				await get(hostPort, "localhost", "/no-access", { Cookie: `__session=${clerk.jwt()}` }),
			).toMatchObject({ status: 302, location: "/sites" });
			expect(await get(hostPort, "localhost", "/site/foo", cookie)).toMatchObject({
				status: 200,
				body: "none",
			});
			expect(
				await get(hostPort, "foo.localhost", "/", { "X-EmDash-Site-Id": "site-other" }),
			).toMatchObject({ status: 200, body: "foo:site-foo" });
			expect(
				await get(hostPort, "foo.localhost", "/", { "X-Forwarded-Host": "localhost" }),
			).toMatchObject({ status: 421 });
			expect(await get(hostPort, "unknown.localhost")).toMatchObject({ status: 421 });
			expect(await get(hostPort, "unbuilt.localhost")).toMatchObject({ status: 503 });

			const customAdminHost = "admin.example.test";
			const customPort = await freePort();
			customHost = spawn(process.execPath, [join(project, "host.mjs")], {
				cwd: project,
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...env,
					PORT: String(customPort),
					EMDASH_ADMIN_HOST: customAdminHost,
					EMDASH_ADMIN_ORIGIN: `http://${customAdminHost}:${customPort}`,
					EMDASH_DEFAULT_HOST: "public.example.test",
				},
			});
			let startupOutput = "";
			customHost.stdout
				?.setEncoding("utf8")
				.on("data", (chunk: string) => (startupOutput += chunk));
			await waitForResponse(customPort, customAdminHost, 302, "/admin");
			for (
				let attempt = 0;
				attempt < 50 && !startupOutput.includes("Public site: http://foo.localhost:");
				attempt++
			) {
				await new Promise((done) => setTimeout(done, 50));
			}
			expect(startupOutput).toContain(
				`[host] Ready: admin http://${customAdminHost}:${customPort}/admin`,
			);
			expect(startupOutput).toContain(`[host] Public site: http://foo.localhost:${customPort}`);
			expect(startupOutput).not.toContain("Public site: http://public.example.test");
			expect(startupOutput).not.toContain("unbuilt.localhost");

			const proxyPort = await freePort();
			const proxyToken = crypto.randomUUID();
			const proxyHeaders = {
				"X-EmDash-Proxy-Token": proxyToken,
				"X-Forwarded-Host": `foo.localhost:${proxyPort}`,
			};
			proxyHost = spawn(process.execPath, [join(project, "host.mjs")], {
				cwd: project,
				stdio: "ignore",
				env: { ...env, PORT: String(proxyPort), EMDASH_PROXY_TOKEN: proxyToken },
			});
			await waitForResponse(proxyPort, "foo.localhost", 200, "/", proxyHeaders);
			expect(await get(proxyPort, "foo.localhost")).toMatchObject({ status: 421 });
			expect(
				await get(proxyPort, "foo.localhost", "/", {
					...proxyHeaders,
					"X-Forwarded-Host": "bar.localhost",
				}),
			).toMatchObject({ status: 421 });
			expect(
				await get(proxyPort, "foo.localhost", "/", {
					...proxyHeaders,
					"X-EmDash-Proxy-Token": "wrong",
				}),
			).toMatchObject({ status: 421 });

			execFileSync("docker", [
				"exec",
				container,
				"psql",
				"-U",
				"postgres",
				"-d",
				"test",
				"-c",
				"UPDATE _emdash_sites SET active = 0 WHERE id = 'site-foo'",
			]);
			expect(await get(hostPort, "foo.localhost")).toMatchObject({ status: 421 });
		} finally {
			host?.kill();
			customHost?.kill();
			proxyHost?.kill();
			await clerk?.close();
			execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
			rmSync(project, { recursive: true, force: true });
		}
	}, 120_000);
});
