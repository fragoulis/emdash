export const clerkSource = `import { createClerkClient, verifyToken } from "@clerk/backend";
import { parsePublishableKey } from "@clerk/shared/keys";

const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const secretKey = process.env.CLERK_SECRET_KEY;
const bootstrapUserId = process.env.CLERK_BOOTSTRAP_USER_ID;
if (!publishableKey || !secretKey || !bootstrapUserId) {
  throw new Error("Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, and CLERK_BOOTSTRAP_USER_ID");
}
const { frontendApi } = parsePublishableKey(publishableKey, { fatal: true });
const clerk = createClerkClient({ secretKey, apiUrl: process.env.EMDASH_CLERK_API_URL });
export const signInUrl = new URL("/sign-in", "https://" + frontendApi);

export async function verifiedIdentity(cookieHeader, origin) {
  const tokens = cookieHeader?.split(";").map((part) => part.trim())
    .filter((part) => part.startsWith("__session=")) ?? [];
  if (tokens.length !== 1) return null;
  const token = tokens[0].slice("__session=".length);
  if (!token) return null;
  let claims;
  try {
    claims = await verifyToken(token, {
      secretKey,
      jwtKey: process.env.CLERK_JWT_KEY,
      apiUrl: process.env.EMDASH_CLERK_API_URL,
      authorizedParties: [origin],
    });
  } catch {
    return null;
  }
  if (claims.iss !== "https://" + frontendApi || claims.azp !== origin ||
    typeof claims.sub !== "string" || !claims.sub.startsWith("user_") ||
    typeof claims.sid !== "string" || !claims.sid.startsWith("sess_")) return null;
  let session;
  let user;
  try {
    session = await clerk.sessions.getSession(claims.sid);
    if (session.status !== "active" || session.userId !== claims.sub) return null;
    user = await clerk.users.getUser(claims.sub);
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 404) return null;
    throw error;
  }
  if (user.id !== claims.sub) return null;
  const email = user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId);
  if (!email || email.verification?.status !== "verified") return null;
  return {
    subject: user.id,
    email: email.emailAddress,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
    isSuperAdmin: user.publicMetadata?.is_super_admin === true,
    role: user.publicMetadata?.is_super_admin === true ? 50 : 0,
  };
}

export async function authenticate(request) {
  const origin = process.env.EMDASH_ADMIN_ORIGIN;
  if (!origin) throw new Error("Set EMDASH_ADMIN_ORIGIN for Clerk authentication");
  const user = await verifiedIdentity(request.headers.get("cookie"), origin);
  if (!user) throw new Error("Clerk authentication required");
  if (!user.isSuperAdmin) throw new Error("EmDash system administration access required");
  return { ...user, role: 50, name: user.name ?? user.email };
}
`;
