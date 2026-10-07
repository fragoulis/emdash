import { afterEach, beforeEach, expect, it } from "vitest";

import * as migration092 from "../../../src/database/migrations/092_site_identity.js";
import {
	describeEachDialect,
	setupForDialect,
	teardownForDialect,
	type DialectTestContext,
} from "../../utils/test-db.js";

describeEachDialect("site identity migration", (dialect) => {
	let ctx: DialectTestContext;

	beforeEach(async () => {
		ctx = await setupForDialect(dialect);
	});

	afterEach(async () => {
		await teardownForDialect(ctx);
	});

	it("keeps site identity when its slug and hostname change", async () => {
		const db = ctx.db;
		await db
			.insertInto("_emdash_sites")
			.values([
				{ id: "site-1", slug: "one" },
				{ id: "site-2", slug: "two" },
			])
			.execute();
		await db
			.insertInto("_emdash_site_hosts")
			.values([
				{ site_id: "site-1", hostname: "one.test" },
				{ site_id: "site-2", hostname: "two.test" },
			])
			.execute();
		await db
			.updateTable("_emdash_sites")
			.set({ slug: "renamed" })
			.where("id", "=", "site-1")
			.execute();
		await db
			.updateTable("_emdash_site_hosts")
			.set({ hostname: "new.test" })
			.where("site_id", "=", "site-1")
			.execute();
		await migration092.up(db);
		await expect(
			db.updateTable("_emdash_sites").set({ id: "changed" }).where("id", "=", "site-1").execute(),
		).rejects.toThrow("Site IDs cannot change");
		expect(
			await db.selectFrom("_emdash_site_hosts").selectAll().orderBy("site_id").execute(),
		).toEqual([
			{ hostname: "new.test", site_id: "site-1" },
			{ hostname: "two.test", site_id: "site-2" },
		]);
		expect(
			await db.selectFrom("_emdash_sites").selectAll().where("id", "=", "site-1").execute(),
		).toEqual([{ id: "site-1", slug: "renamed", active: 1 }]);
	});
});
