import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runWithContext } from "emdash/request-context";

import { resolveSite } from "../../demos/postgres/site-registry.mjs";

const builds = new Map([
	["site-foo", "foo"],
	["site-bar", "bar"],
]);

const handlers = new Map();
for (const [siteId, site] of builds) {
	const entry = resolve(
		process.env.PROOF_BUILD_DIR ?? "demos/postgres/proof/dist",
		site,
		"server/entry.mjs",
	);
	const { handler } = await import(pathToFileURL(entry).href);
	handlers.set(siteId, handler);
}

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
		forwardedHost !== host
	) {
		response.writeHead(421);
		response.end();
		return;
	}
	try {
		const siteId = await resolveSite(host);
		const handler = siteId && handlers.get(siteId);
		if (
			!handler ||
			(request.method !== "GET" && request.method !== "HEAD") ||
			request.url?.startsWith("/_emdash")
		) {
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
