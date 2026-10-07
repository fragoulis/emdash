import { sql } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";

import * as migration from "../../../src/database/migrations/095_published_content_sites.js";
import { createMigrator } from "../../../src/database/migrations/runner.js";
import {
	createForDialect,
	describeEachDialect,
	teardownForDialect,
	type DialectTestContext,
} from "../../utils/test-db.js";

describeEachDialect("published content site upgrade", (dialect) => {
	let ctx: DialectTestContext;

	beforeEach(async () => {
		ctx = await createForDialect(dialect);
		const { error } = await createMigrator(ctx.db, {
			migrationTableSchema: ctx.pgCtx?.schemaName,
		}).migrateTo("094_required_site_ownership");
		if (error) throw error;
		await ctx.db.schema
			.createTable("ec_posts")
			.addColumn("id", "text", (column) => column.primaryKey())
			.addColumn("slug", "text")
			.addColumn("locale", "text", (column) => column.notNull().defaultTo("en"))
			.addUniqueConstraint("ec_posts_slug_locale_unique", ["slug", "locale"])
			.execute();
		await sql`INSERT INTO ec_posts (id, slug) VALUES ('before', 'shared')`.execute(ctx.db);
	});

	afterEach(async () => teardownForDialect(ctx));

	it("retains old entries under the default site after retry", async () => {
		await migration.up(ctx.db);
		await migration.up(ctx.db);
		const rows = await sql<{
			site_id: string;
		}>`SELECT site_id FROM ec_posts WHERE id = 'before'`.execute(ctx.db);
		expect(rows.rows).toEqual([{ site_id: "site-default" }]);
	});

	if (dialect === "postgres") {
		it("permits matching slugs in a second site after upgrade", async () => {
			await migration.up(ctx.db);
			await sql`INSERT INTO _emdash_sites (id, slug) VALUES ('site-foo', 'foo')`.execute(ctx.db);
			await sql`INSERT INTO ec_posts (id, site_id, slug, locale) VALUES ('second', 'site-foo', 'shared', 'en')`.execute(
				ctx.db,
			);
			await expect(
				sql`INSERT INTO ec_posts (id, site_id, slug, locale) VALUES ('duplicate', 'site-foo', 'shared', 'en')`.execute(
					ctx.db,
				),
			).rejects.toThrow();
			expect(
				(await sql`SELECT id FROM ec_posts WHERE slug = 'shared' ORDER BY id`.execute(ctx.db)).rows,
			).toEqual([{ id: "before" }, { id: "second" }]);
		});
	}
});
