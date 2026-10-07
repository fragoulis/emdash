import type { APIRoute } from "astro";
import { getRequestContext } from "emdash/request-context";
import { Client } from "pg";

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
	const siteId = getRequestContext()?.siteId;
	if (!siteId) return new Response(null, { status: 421 });
	const client = new Client({ connectionString: process.env.DATABASE_URL });
	try {
		await client.connect();
		const result = await client.query(
			`SELECT title FROM ec_posts
			 WHERE site_id = $1 AND (slug = $2 OR id = $2)
			 AND locale = 'en' AND status = 'published' LIMIT 1`,
			[siteId, params.identifier],
		);
		if (!result.rows[0]) return new Response(null, { status: 404 });
		return Response.json(result.rows[0]);
	} finally {
		await client.end();
	}
};
