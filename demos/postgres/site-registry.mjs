import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function resolveSite(hostname) {
	const { rows } = await pool.query(
		`SELECT s.id FROM _emdash_sites s
		 JOIN _emdash_site_hosts h ON h.site_id = s.id
		 WHERE h.hostname = $1 AND s.active = 1`,
		[hostname],
	);
	return rows[0]?.id;
}
