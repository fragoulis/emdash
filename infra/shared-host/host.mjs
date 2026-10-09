import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runWithContext } from "emdash/request-context";

import { resolveSite } from "./site-registry.mjs";

const centralPathPattern = /^\/(?:_emdash(?:\/|$)|admin(?:\/|$)|preview(?:\/|$))/;
const adminHost = process.env.PROOF_ADMIN_HOST;
if (!adminHost || !/^[a-z0-9.-]+$/.test(adminHost)) {
	throw new Error("Set PROOF_ADMIN_HOST to a trusted hostname");
}

const builds = new Map([
	["site-foo", "foo"],
	["site-bar", "bar"],
]);

const handlers = new Map();
const buildDirectory = process.env.PROOF_BUILD_DIR ?? "infra/shared-host/site/dist";
for (const [siteId, site] of builds) {
	const entry = resolve(buildDirectory, site, "server/entry.mjs");
	const { handler } = await import(pathToFileURL(entry).href);
	handlers.set(siteId, handler);
}

const { handler: adminHandler } = await import(
	pathToFileURL(resolve(buildDirectory, "admin/server/entry.mjs")).href
);

const server = createServer(async (request, response) => {
	const host = request.headers.host;
	const forwardedHost = request.headers["x-forwarded-host"];
	if (
		!process.env.PROOF_PROXY_TOKEN ||
		request.headers["x-proof-proxy-token"] !== process.env.PROOF_PROXY_TOKEN ||
		!host ||
		Array.isArray(host) ||
		!forwardedHost ||
		Array.isArray(forwardedHost) ||
		forwardedHost !== host ||
		host.includes(":") ||
		host.includes(",") ||
		request.headers.forwarded !== undefined ||
		request.headers["x-original-host"] !== undefined
	) {
		response.writeHead(421);
		response.end();
		return;
	}
	try {
		const siteId = await resolveSite(host);
		const path = new URL(request.url ?? "/", "http://localhost").pathname;
		const centralPath = centralPathPattern.test(path);
		if (host === adminHost) {
			if (siteId || (request.method !== "GET" && request.method !== "HEAD")) {
				response.writeHead(421);
				response.end();
				return;
			}
			if (path === "/admin" || path === "/admin/") {
				response.writeHead(302, { Location: "/_emdash/admin/login", "Cache-Control": "no-store" });
				response.end();
				return;
			}
			if (path !== "/_emdash/admin/login" && !path.startsWith("/_astro/")) {
				response.writeHead(403, { "Cache-Control": "no-store" });
				response.end();
				return;
			}
			runWithContext({ editMode: false }, () => adminHandler(request, response));
			return;
		}
		const handler = siteId && handlers.get(siteId);
		if (!handler || (request.method !== "GET" && request.method !== "HEAD") || centralPath) {
			response.writeHead(421);
			response.end();
			return;
		}
		runWithContext({ editMode: false, siteId }, () => handler(request, response));
	} catch (error) {
		console.error("[shared-host] Site resolution failed:", error);
		response.writeHead(503);
		response.end();
	}
});

server.listen(Number(process.env.PROOF_PORT ?? 8080), "127.0.0.1");
