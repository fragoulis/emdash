import { generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";

type FixtureState = { active: boolean; superAdmin: boolean; available: boolean };

export async function startClerkFixture(origin: string) {
	const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	const state: FixtureState = { active: true, superAdmin: true, available: true };
	const server = createServer((request, response) => {
		response.setHeader("Content-Type", "application/json");
		if (!state.available) {
			response.writeHead(503);
			response.end(
				JSON.stringify({ errors: [{ code: "service_unavailable", message: "Unavailable" }] }),
			);
			return;
		}
		if (request.url === "/v1/sessions/sess_fixture") {
			response.end(
				JSON.stringify({
					object: "session",
					id: "sess_fixture",
					user_id: "user_fixture",
					status: state.active ? "active" : "revoked",
				}),
			);
			return;
		}
		if (request.url === "/v1/users/user_fixture") {
			response.end(
				JSON.stringify({
					object: "user",
					id: "user_fixture",
					public_metadata: { is_super_admin: state.superAdmin },
					primary_email_address_id: "idn_fixture",
					email_addresses: [
						{
							id: "idn_fixture",
							email_address: "admin+fixture@test.com",
							verification: { status: "verified" },
							linked_to: [],
						},
					],
					first_name: "Test",
					last_name: "Admin",
				}),
			);
			return;
		}
		response.writeHead(404);
		response.end(
			JSON.stringify({ errors: [{ code: "resource_not_found", message: "Not found" }] }),
		);
	});
	await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Expected a TCP address");
	const now = Math.floor(Date.now() / 1000);
	const jwt = (claims: Record<string, unknown> = {}) => {
		const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "fixture" })).toString(
			"base64url",
		);
		const payload = Buffer.from(
			JSON.stringify({
				sid: "sess_fixture",
				sub: "user_fixture",
				iss: "https://fixture.clerk.accounts.dev",
				azp: origin,
				iat: now,
				nbf: now,
				exp: now + 300,
				...claims,
			}),
		).toString("base64url");
		const signingInput = `${header}.${payload}`;
		return `${signingInput}.${sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url")}`;
	};
	return {
		state,
		jwt,
		url: `http://127.0.0.1:${address.port}`,
		publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
		publishableKey: `pk_test_${Buffer.from("fixture.clerk.accounts.dev$").toString("base64url")}`,
		close: () => new Promise<void>((done) => server.close(() => done())),
	};
}
