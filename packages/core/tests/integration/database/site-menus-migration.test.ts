import { sql } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";

import { up } from "../../../src/database/migrations/099_site_menus.js";
import { createMigrator } from "../../../src/database/migrations/runner.js";
import {
	createForDialect,
	describeEachDialect,
	teardownForDialect,
	type DialectTestContext,
} from "../../utils/test-db.js";

describeEachDialect("site menu upgrade", (dialect) => {
	let ctx: DialectTestContext;
	beforeEach(async () => {
		ctx = await createForDialect(dialect);
		const result = await createMigrator(ctx.db, {
			migrationTableSchema: ctx.pgCtx?.schemaName,
		}).migrateTo("097_site_settings");
		if (result.error) throw result.error;
	});
	afterEach(async () => {
		await teardownForDialect(ctx);
	});

	it("backfills legacy menus and items and permits same-name menus on two sites", async () => {
		await sql`INSERT INTO _emdash_menus (id, name, label, locale, translation_group)
			VALUES ('old-menu', 'primary', 'Legacy', 'en', 'old-menu')`.execute(ctx.db);
		await sql`INSERT INTO _emdash_menu_items (id, menu_id, type, label, sort_order, locale)
			VALUES ('old-item', 'old-menu', 'custom', 'Legacy link', 0, 'en')`.execute(ctx.db);
		await up(ctx.db);
		await up(ctx.db);
		const menus = await sql<{ id: string; site_id: string }>`
			SELECT id, site_id FROM _emdash_menus ORDER BY id`.execute(ctx.db);
		expect(menus.rows).toEqual([{ id: "old-menu", site_id: "site-default" }]);
		const items = await sql<{ id: string; site_id: string }>`
			SELECT id, site_id FROM _emdash_menu_items ORDER BY id`.execute(ctx.db);
		expect(items.rows).toEqual([{ id: "old-item", site_id: "site-default" }]);
		await sql`INSERT INTO _emdash_menus (id, site_id, name, label, locale)
			VALUES ('foo-menu', 'foo', 'primary', 'Foo', 'en'),
			('bar-menu', 'bar', 'primary', 'Bar', 'en')`.execute(ctx.db);
		await expect(
			sql`INSERT INTO _emdash_menus (id, site_id, name, label, locale)
			VALUES ('duplicate', 'foo', 'primary', 'Another Foo', 'en')`.execute(ctx.db),
		).rejects.toThrow();
		await expect(
			sql`INSERT INTO _emdash_menus (id, name, label, locale)
			VALUES ('unscoped', 'other', 'Missing site', 'en')`.execute(ctx.db),
		).rejects.toThrow();
	});

	it("runs through the registered migrator", async () => {
		await sql`INSERT INTO _emdash_menus (id, name, label) VALUES ('old-menu', 'primary', 'Legacy')`.execute(
			ctx.db,
		);
		const result = await createMigrator(ctx.db, {
			migrationTableSchema: ctx.pgCtx?.schemaName,
		}).migrateToLatest();
		if (result.error) throw result.error;
		const row = await sql<{
			site_id: string;
		}>`SELECT site_id FROM _emdash_menus WHERE id = 'old-menu'`.execute(ctx.db);
		expect(row.rows[0]?.site_id).toBe("site-default");
	});
});
