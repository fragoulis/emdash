import { execFileSync, spawn, type ChildProcess } from "node:child_process";
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
		request.end();
	});
}

async function waitForResponse(
	port: number,
	host: string,
	expected: number,
	path = "/",
	headers: Record<string, string> = {},
): Promise<void> {
	for (let i = 0; i < 100; i++) {
		try {
			if ((await get(port, host, path, headers)).status === expected) return;
		} catch {
			// The process may still be starting.
		}
		await new Promise((done) => setTimeout(done, 100));
	}
	throw new Error(`Generated host did not return ${expected} for ${host}${path}`);
}

describe("generated host", () => {
	it("serves the registered site without routing central admin or spoofed hosts to it", async () => {
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
		let proxyHost: ChildProcess | undefined;
		let clerk: Awaited<ReturnType<typeof startClerkFixture>> | undefined;
		try {
			const mapping = execFileSync("docker", ["port", container, "5432"], { encoding: "utf8" });
			const port = Number(mapping.match(/127\.0\.0\.1:(\d+)/)?.[1]);
			if (!port) throw new Error("Missing PostgreSQL port");
			for (let i = 0; i < 100; i++) {
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
			const sql =
				"CREATE TABLE _emdash_sites (id text PRIMARY KEY, active integer NOT NULL); " +
				"CREATE TABLE _emdash_site_hosts (hostname text PRIMARY KEY, site_id text NOT NULL REFERENCES _emdash_sites(id)); " +
				"CREATE TABLE users (id text PRIMARY KEY, email text UNIQUE NOT NULL, name text, avatar_url text, role integer, email_verified integer, data text, disabled integer NOT NULL DEFAULT 0, created_at text, updated_at text); " +
				"CREATE TABLE oauth_accounts (provider text, provider_account_id text, user_id text REFERENCES users(id), PRIMARY KEY(provider, provider_account_id)); " +
				"INSERT INTO _emdash_sites VALUES ('site-default', 1)";
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
			cpSync(join(template, "src"), join(project, "src"), { recursive: true });
			cpSync(join(template, "astro.config.mjs"), join(project, "astro.config.mjs"));
			prepareDefaultPresentation(project);
			linkScaffoldDependencies(project);
			mkdirSync(join(project, "dist/server"), { recursive: true });
			writeFileSync(
				join(project, "dist/server/entry.mjs"),
				'import { getRequestContext } from "emdash/request-context";\n' +
					'export function handler(request, response) { if (request.url === "/explode") throw new Error("Fixture failure"); response.end(getRequestContext()?.siteId ?? "none"); }\n',
			);
			const hostPort = await freePort();
			clerk = await startClerkFixture(`http://localhost:${hostPort}`);
			const clerkEnv = {
				NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerk.publishableKey,
				CLERK_SECRET_KEY: "sk_test_fixture",
				CLERK_BOOTSTRAP_USER_ID: "user_fixture",
				CLERK_JWT_KEY: clerk.publicKey,
				EMDASH_CLERK_API_URL: clerk.url,
			};
			const cookie = { Cookie: `__session=${clerk.jwt()}` };
			host = spawn(process.execPath, [join(project, "host.mjs")], {
				cwd: project,
				stdio: "ignore",
				env: {
					PATH: process.env.PATH,
					DATABASE_URL: `postgres://postgres:${password}@127.0.0.1:${port}/test`,
					PORT: String(hostPort),
					...clerkEnv,
				},
			});
			await waitForResponse(hostPort, "localhost", 302, "/admin");
			expect(await get(hostPort, "default.localhost")).toMatchObject({ status: 421 });
			expect(await get(hostPort, "localhost", "/_emdash/admin/setup")).toMatchObject({
				status: 302,
			});
			expect(await get(hostPort, "localhost", "/_emdash/admin/setup", cookie)).toMatchObject({
				status: 200,
				body: "site-default",
			});
			await waitForResponse(hostPort, "default.localhost", 200);
			expect(await get(hostPort, "default.localhost")).toMatchObject({
				status: 200,
				body: "site-default",
			});
			expect(await get(hostPort, "default.localhost", "/explode")).toMatchObject({ status: 500 });
			expect(await get(hostPort, "default.localhost")).toMatchObject({ status: 200 });
			expect(await get(hostPort, "default.localhost", "/_emdash/admin")).toMatchObject({
				status: 421,
			});
			expect(await get(hostPort, "localhost", "/")).toMatchObject({ status: 403 });
			expect(await get(hostPort, "localhost", "/_emdash/api/setup", {}, "POST")).toMatchObject({
				status: 403,
			});
			expect(await get(hostPort, "localhost", "/_emdash/api/setup", cookie, "POST")).toMatchObject({
				status: 403,
			});
			expect(
				await get(
					hostPort,
					"localhost",
					"/_emdash/api/setup",
					{
						...cookie,
						Origin: `http://localhost:${hostPort}`,
						"X-EmDash-Request": "1",
					},
					"POST",
				),
			).toMatchObject({ status: 200, body: "site-default" });
			const linked = execFileSync(
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
					"SELECT provider_account_id FROM oauth_accounts WHERE provider = 'clerk'",
				],
				{ encoding: "utf8" },
			);
			expect(linked.trim()).toBe("user_fixture");
			clerk.state.superAdmin = false;
			expect(await get(hostPort, "localhost", "/_emdash/admin/setup", cookie)).toMatchObject({
				status: 302,
			});
			clerk.state.superAdmin = true;
			clerk.state.active = false;
			expect(await get(hostPort, "localhost", "/_emdash/admin/setup", cookie)).toMatchObject({
				status: 302,
			});
			clerk.state.active = true;
			expect(
				await get(hostPort, "localhost", "/_emdash/api/setup/status", {
					Cookie: `__session=${clerk.jwt({ exp: 1 })}`,
				}),
			).toMatchObject({ status: 401 });
			expect(
				await get(hostPort, "localhost", "/_emdash/admin/setup", {
					Cookie: `__session=${clerk.jwt({ sub: "user_other" })}`,
				}),
			).toMatchObject({ status: 302 });
			clerk.state.available = false;
			expect(await get(hostPort, "localhost", "/_emdash/admin/setup", cookie)).toMatchObject({
				status: 503,
			});
			expect(await get(hostPort, "default.localhost")).toMatchObject({ status: 200 });
			clerk.state.available = true;
			expect(await get(hostPort, "localhost", "/_emdash/api/setup/dev-bypass")).toMatchObject({
				status: 403,
			});
			expect(await get(hostPort, "unknown.localhost")).toMatchObject({ status: 421 });
			expect(
				await get(hostPort, "default.localhost", "/", { "X-EmDash-Site-Id": "site-other" }),
			).toMatchObject({ status: 200, body: "site-default" });
			expect(
				await get(hostPort, "default.localhost", "/", { "X-Forwarded-Host": "localhost" }),
			).toMatchObject({ status: 421 });
			const proxyPort = await freePort();
			const proxyHeaders = {
				"X-EmDash-Proxy-Token": crypto.randomUUID(),
				"X-Forwarded-Host": `default.localhost:${proxyPort}`,
			};
			proxyHost = spawn(process.execPath, [join(project, "host.mjs")], {
				cwd: project,
				stdio: "ignore",
				env: {
					PATH: process.env.PATH,
					DATABASE_URL: `postgres://postgres:${password}@127.0.0.1:${port}/test`,
					PORT: String(proxyPort),
					EMDASH_PROXY_TOKEN: proxyHeaders["X-EmDash-Proxy-Token"],
					...clerkEnv,
				},
			});
			await waitForResponse(proxyPort, "default.localhost", 200, "/", proxyHeaders);
			expect(await get(proxyPort, "default.localhost")).toMatchObject({ status: 421 });
			expect(
				await get(proxyPort, "default.localhost", "/", {
					...proxyHeaders,
					"X-Forwarded-Host": "site-other.localhost",
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
				"UPDATE _emdash_sites SET active = 0 WHERE id = 'site-default'",
			]);
			expect(await get(hostPort, "default.localhost")).toMatchObject({ status: 421 });
		} finally {
			host?.kill();
			proxyHost?.kill();
			await clerk?.close();
			execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
			rmSync(project, { recursive: true, force: true });
		}
	}, 60_000);
});
