import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { clerkSource } from "../src/multisite-clerk.js";
import { startClerkFixture } from "./clerk-fixture.js";

describe("generated Clerk provider", () => {
	it("accepts arbitrary backend-verified super admins and rejects ordinary or invalid identities", async () => {
		const directory = mkdtempSync(join(tmpdir(), "emdash-clerk-"));
		const origin = "http://localhost:4321";
		const fixture = await startClerkFixture(origin);
		const env = {
			NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: fixture.publishableKey,
			CLERK_SECRET_KEY: "sk_test_fixture",
			CLERK_BOOTSTRAP_USER_ID: "user_bootstrap_not_the_admin",
			CLERK_JWT_KEY: fixture.publicKey,
			EMDASH_CLERK_API_URL: fixture.url,
			EMDASH_ADMIN_ORIGIN: origin,
		};
		const previous = new Map<string, string | undefined>();
		try {
			for (const [key, value] of Object.entries(env)) {
				previous.set(key, process.env[key]);
				process.env[key] = value;
			}
			const modulePath = join(directory, "clerk.mjs");
			writeFileSync(modulePath, clerkSource);
			const clerk = await import(`${pathToFileURL(modulePath).href}?fixture`);
			const tokenCookie = `__session=${fixture.jwt()}`;
			expect(await clerk.verifiedIdentity(null, origin)).toBeNull();
			expect(await clerk.verifiedIdentity("__session=not-a-token", origin)).toBeNull();
			expect(
				await clerk.verifiedIdentity(`__session=${fixture.jwt({ sid: "sess_missing" })}`, origin),
			).toBeNull();
			const verified = await clerk.verifiedIdentity(tokenCookie, origin);
			expect(verified).toMatchObject({ subject: "user_fixture", isSuperAdmin: true, role: 50 });
			await expect(
				clerk.authenticate(new Request(origin, { headers: { cookie: tokenCookie } })),
			).resolves.toMatchObject({ subject: "user_fixture", role: 50 });

			fixture.state.superAdmin = false;
			const staff = await clerk.verifiedIdentity(tokenCookie, origin);
			expect(staff).toMatchObject({ subject: "user_fixture", isSuperAdmin: false });
			expect(
				await clerk.verifiedIdentity(
					`__session=${fixture.jwt({ public_metadata: { is_super_admin: true } })}`,
					origin,
				),
			).toMatchObject({ isSuperAdmin: false });
			await expect(
				clerk.authenticate(new Request(origin, { headers: { cookie: tokenCookie } })),
			).rejects.toThrow("system administration access required");
			expect(
				await clerk.verifiedIdentity(`__session=${fixture.jwt({ exp: 1 })}`, origin),
			).toBeNull();
			expect(
				await clerk.verifiedIdentity(
					`__session=${fixture.jwt({ iss: "https://wrong-issuer" })}`,
					origin,
				),
			).toBeNull();
			expect(
				await clerk.verifiedIdentity(
					`__session=${fixture.jwt({ azp: "https://wrong-party" })}`,
					origin,
				),
			).toBeNull();
			fixture.state.active = false;
			expect(await clerk.verifiedIdentity(tokenCookie, origin)).toBeNull();
			fixture.state.active = true;
			fixture.state.sessionUserId = "user_other";
			expect(await clerk.verifiedIdentity(tokenCookie, origin)).toBeNull();
			fixture.state.sessionUserId = "user_fixture";
			fixture.state.emailVerified = false;
			expect(await clerk.verifiedIdentity(tokenCookie, origin)).toBeNull();
			fixture.state.emailVerified = true;
			fixture.state.primaryEmailAddressId = null;
			expect(await clerk.verifiedIdentity(tokenCookie, origin)).toBeNull();
			fixture.state.primaryEmailAddressId = "idn_fixture";
			fixture.state.available = false;
			await expect(clerk.verifiedIdentity(tokenCookie, origin)).rejects.toThrow();
		} finally {
			for (const [key, value] of previous) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			await fixture.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
