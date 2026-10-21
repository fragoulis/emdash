import { describe, expect, it } from "vitest";

import { createSite } from "../src/site-command.js";

describe("createSite", () => {
	it("rejects invalid slugs before accessing an installation", async () => {
		await expect(createSite(["Bad Slug"], "/missing-installation")).rejects.toThrow(
			/unique lowercase slug/,
		);
	});
});
