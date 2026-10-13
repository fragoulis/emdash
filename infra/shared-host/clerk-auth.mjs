import { createClerkClient, verifyToken } from "@clerk/backend";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function clerkClient() {
	if (!process.env.CLERK_SECRET_KEY) throw new Error("Clerk backend key is not configured");
	return createClerkClient({
		secretKey: process.env.CLERK_SECRET_KEY,
		apiUrl: process.env.PROOF_CLERK_API_URL,
	});
}

async function verifiedSession(request) {
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
	const clerk = clerkClient();
	const session = await clerk.sessions.getSession(data.sid);
	if (session.status !== "active" || session.userId !== data.sub) return null;
	return { userId: data.sub, sessionId: data.sid, clerk };
}

export async function staffIdentity(request) {
	const session = await verifiedSession(request);
	if (!session) return null;
	await pool.query(
		"INSERT INTO proof_staff (provider_user_id) VALUES ($1) ON CONFLICT (provider_user_id) DO NOTHING",
		[session.userId],
	);
	return session.userId;
}

export async function staffAuthority(request, siteSlug) {
	const session = await verifiedSession(request);
	if (!session) return null;
	const user = await session.clerk.users.getUser(session.userId);
	if (user.id !== session.userId) return null;
	const { rows } = await pool.query(
		`SELECT s.id AS site_id, m.role FROM _emdash_sites s
		 LEFT JOIN proof_site_memberships m ON m.site_id = s.id AND m.provider_user_id = $2
		 WHERE s.slug = $1 AND s.active = 1`,
		[siteSlug, session.userId],
	);
	const site = rows[0];
	if (!site) return null;
	const superAdmin = user.publicMetadata?.is_super_admin === true;
	if (!superAdmin && site.role === null) return null;
	return {
		actorId: session.userId,
		siteId: site.site_id,
		role: superAdmin ? 50 : site.role,
		superAdmin,
	};
}

export async function signOutStaff(request) {
	const session = await verifiedSession(request);
	if (!session) return false;
	await session.clerk.sessions.revokeSession(session.sessionId);
	return true;
}
