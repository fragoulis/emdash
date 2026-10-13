import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
	await pool.query("CREATE TABLE IF NOT EXISTS proof_staff (provider_user_id text PRIMARY KEY)");
	await pool.query(`CREATE TABLE IF NOT EXISTS proof_site_memberships (
		provider_user_id text NOT NULL REFERENCES proof_staff(provider_user_id),
		site_id text NOT NULL REFERENCES _emdash_sites(id),
		role integer NOT NULL CHECK (role IN (10, 20, 30, 40, 50)),
		PRIMARY KEY (provider_user_id, site_id)
	)`);
} finally {
	await pool.end();
}
