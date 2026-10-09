import { verifyToken } from "@clerk/backend";
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function staffIdentity(request) {
	const cookie = request.headers.cookie
		?.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith("__session="));
	const token = cookie?.slice("__session=".length);
	if (!token) return null;
	const origin = process.env.PROOF_ADMIN_ORIGIN;
	const issuer = process.env.PROOF_CLERK_ISSUER;
	if (!origin || !issuer || !process.env.CLERK_JWT_KEY)
		throw new Error("Clerk verification is not configured");
	const data = await verifyToken(token, {
		jwtKey: process.env.CLERK_JWT_KEY,
		authorizedParties: [origin],
	});
	if (
		!data ||
		data.iss !== issuer ||
		data.azp !== origin ||
		!data.sub?.startsWith("user_") ||
		!data.sid?.startsWith("sess_")
	)
		return null;
	const result = await pool.query(
		"INSERT INTO proof_staff (provider_user_id) VALUES ($1) ON CONFLICT (provider_user_id) DO UPDATE SET provider_user_id = EXCLUDED.provider_user_id RETURNING provider_user_id",
		[data.sub],
	);
	return result.rows[0]?.provider_user_id ?? null;
}
