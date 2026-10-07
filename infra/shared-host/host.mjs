import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const builds = new Map([
	["foo.test", "foo"],
	["bar.test", "bar"],
]);

const handlers = new Map();
for (const [hostname, site] of builds) {
	const entry = resolve(
		process.env.PROOF_BUILD_DIR ?? "demos/postgres/proof/dist",
		site,
		"server/entry.mjs",
	);
	const { handler } = await import(pathToFileURL(entry).href);
	handlers.set(hostname, handler);
}

const server = createServer((request, response) => {
	// The origin accepts only one Host value. Caddy forwards the validated hostname.
	const host = request.headers.host;
	if (!host || Array.isArray(host) || !builds.has(host)) {
		response.writeHead(421, { "content-type": "text/plain" });
		response.end("Unknown host");
		return;
	}
	handlers.get(host)(request, response);
});

server.listen(Number(process.env.PROOF_PORT ?? 8080), "127.0.0.1");
