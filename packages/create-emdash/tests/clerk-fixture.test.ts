import { verifyToken } from "@clerk/backend";
import { expect, it, vi } from "vitest";

import { startClerkFixture } from "./clerk-fixture.js";

it("issues usable credentials after the original browser session token expires", async () => {
	const origin = "http://localhost:4321";
	const fixture = await startClerkFixture(origin);
	try {
		const original = fixture.jwt();
		vi.setSystemTime(Date.now() + 10 * 60_000);
		const options = { jwtKey: fixture.publicKey, authorizedParties: [origin] };
		await expect(verifyToken(original, options)).rejects.toThrow();
		await expect(verifyToken(fixture.jwt(), options)).resolves.toMatchObject({
			sub: "user_fixture",
		});
	} finally {
		vi.useRealTimers();
		await fixture.close();
	}
});
