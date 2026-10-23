import { afterEach, aroundEach, beforeEach, expect, it } from "vitest";

import { OptionsRepository } from "../../../src/database/repositories/options.js";
import { SiteSettingsRepository } from "../../../src/database/repositories/site-settings.js";
import { runWithContext } from "../../../src/request-context.js";
import {
	normalizeSiteSettingsVersion,
	siteSettingsVersionQuery,
} from "../../../src/settings/version.js";
import {
	describeEachDialect,
	setupForDialect,
	teardownForDialect,
	type DialectTestContext,
} from "../../utils/test-db.js";

describeEachDialect("site settings version", (dialect) => {
	let ctx: DialectTestContext | undefined;

	aroundEach((runTest) => runWithContext({ editMode: false, siteId: "site-default" }, runTest));

	beforeEach(async () => {
		ctx = await setupForDialect(dialect);
	});

	afterEach(async () => {
		await teardownForDialect(ctx);
		ctx = undefined;
	});

	async function readVersion(): Promise<string> {
		if (!ctx) throw new Error("test database is not initialized");
		const row = await ctx.db
			.selectNoFrom(siteSettingsVersionQuery(ctx.db).as("version"))
			.executeTakeFirstOrThrow();
		return normalizeSiteSettingsVersion(row.version);
	}

	it("changes for site setting insert, update, and deletion but not unrelated writes", async () => {
		if (!ctx) throw new Error("test database is not initialized");
		const options = new OptionsRepository(ctx.db);
		const settings = new SiteSettingsRepository(ctx.db);

		const empty = await readVersion();
		expect(empty).toBe("[]");

		await settings.set("title", "First");
		const inserted = await readVersion();
		expect(inserted).not.toBe(empty);

		await settings.set("title", "Second");
		const updated = await readVersion();
		expect(updated).not.toBe(inserted);

		await options.set("unrelated", "value");
		expect(await readVersion()).toBe(updated);

		await runWithContext({ editMode: false, siteId: "other-site" }, () =>
			settings.set("title", "Other site"),
		);
		expect(await readVersion()).toBe(updated);

		await settings.delete("title");
		expect(await readVersion()).not.toBe(updated);
		expect(await readVersion()).toBe(empty);
	});
});
