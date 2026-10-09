import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
	await pool.query("CREATE TABLE IF NOT EXISTS proof_staff (provider_user_id text PRIMARY KEY)");
} finally {
	await pool.end();
}
