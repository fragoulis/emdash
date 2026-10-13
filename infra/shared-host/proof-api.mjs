import { Pool } from "pg";

import { staffAuthority } from "./clerk-auth.mjs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const entryPath = /^\/_emdash\/api\/proof\/sites\/([a-z][a-z0-9_-]*)\/entries\/([a-z][a-z0-9_-]*)$/;

export async function handleProofApi(request, response, path) {
	const match = entryPath.exec(path);
	if (!match || !["GET", "PUT"].includes(request.method)) return false;
	response.setHeader("Cache-Control", "no-store");
	let authority;
	try {
		authority = await staffAuthority(request, match[1]);
	} catch (error) {
		if (!error?.reason?.startsWith("token-") && error?.status !== 404) {
			console.error("[shared-host] Proof authorization failed:", error);
		}
		response.writeHead(error?.reason?.startsWith("token-") || error?.status === 404 ? 403 : 503);
		response.end();
		return true;
	}
	if (!authority || authority.role < (request.method === "GET" ? 10 : 40)) {
		response.writeHead(403);
		response.end();
		return true;
	}
	if (request.method === "PUT") {
		if (
			request.headers.origin !== process.env.PROOF_ADMIN_ORIGIN ||
			request.headers["x-emdash-request"] !== "1" ||
			request.headers["content-type"] !== "application/json"
		) {
			response.writeHead(403);
			response.end();
			return true;
		}
	}
	try {
		let title;
		if (request.method === "PUT") {
			let body = "";
			for await (const chunk of request) {
				body += chunk;
				if (body.length > 4096) {
					response.writeHead(413);
					response.end();
					return true;
				}
			}
			const parsed = JSON.parse(body);
			if (typeof parsed.title !== "string" || !parsed.title.trim() || parsed.title.length > 200) {
				response.writeHead(400);
				response.end();
				return true;
			}
			title = parsed.title;
		}
		const { rows } =
			request.method === "PUT"
				? await pool.query(
						"UPDATE ec_posts SET title = $1 WHERE id = $2 AND site_id = $3 RETURNING title",
						[title, match[2], authority.siteId],
					)
				: await pool.query("SELECT title FROM ec_posts WHERE id = $1 AND site_id = $2", [
						match[2],
						authority.siteId,
					]);
		if (!rows[0]) {
			response.writeHead(404);
			response.end();
			return true;
		}
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(
			JSON.stringify({
				title: rows[0].title,
				siteId: authority.siteId,
				actorId: authority.actorId,
			}),
		);
	} catch (error) {
		if (error instanceof SyntaxError) {
			response.writeHead(400);
		} else {
			console.error("[shared-host] Proof request failed:", error);
			response.writeHead(503);
		}
		response.end();
	}
	return true;
}
