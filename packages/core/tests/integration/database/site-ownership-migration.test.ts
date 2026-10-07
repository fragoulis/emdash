import { sql } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";

import * as backfill from "../../../src/database/migrations/093_default_site.js";
import * as enforce from "../../../src/database/migrations/094_required_site_ownership.js";
import { createMigrator } from "../../../src/database/migrations/runner.js";
import {
	createForDialect,
	describeEachDialect,
	teardownForDialect,
	type DialectTestContext,
} from "../../utils/test-db.js";

describeEachDialect("site ownership upgrade", (dialect) => {
	let ctx: DialectTestContext;

	beforeEach(async () => {
		ctx = await createForDialect(dialect);
		const { error } = await createMigrator(ctx.db, {
			migrationTableSchema: ctx.pgCtx?.schemaName,
		}).migrateTo("092_site_identity");
		if (error) throw error;
	});

	afterEach(async () => {
		await teardownForDialect(ctx);
	});

	it("assigns existing rows to a stable default site and rejects null ownership", async () => {
		const db = ctx.db;
		await db.insertInto("options").values({ name: "existing", value: "1" }).execute();
		await sql`INSERT INTO media (id, filename, mime_type, storage_key) VALUES ('image-1', 'image.png', 'image/png', 'image.png')`.execute(
			db,
		);
		await sql`INSERT INTO taxonomies (id, name, slug, label) VALUES ('topic-1', 'topics', 'topic', 'Topics')`.execute(
			db,
		);
		await sql`INSERT INTO _emdash_collections (id, slug, label) VALUES ('posts-1', 'posts', 'Posts')`.execute(
			db,
		);
		await backfill.up(db);
		await backfill.up(db);
		expect(
			await db
				.selectFrom("options")
				.select("site_id")
				.where("name", "=", "existing")
				.executeTakeFirst(),
		).toEqual({ site_id: "site-default" });
		await enforce.up(db);
		await enforce.up(db);
		for (const [table, key, id] of [
			["media", "id", "image-1"],
			["taxonomies", "id", "topic-1"],
			["_emdash_collections", "id", "posts-1"],
		] as const) {
			const result = await sql<{
				site_id: string;
			}>`SELECT site_id FROM ${sql.ref(table)} WHERE ${sql.ref(key)} = ${id}`.execute(db);
			expect(result.rows).toEqual([{ site_id: "site-default" }]);
		}
		await backfill.up(db);
		await expect(
			sql`INSERT INTO options (name, value, site_id) VALUES ('bad', '1', NULL)`.execute(db),
		).rejects.toThrow();
		await db.insertInto("options").values({ name: "new", value: "2" }).execute();
		expect(
			await db.selectFrom("options").select("site_id").where("name", "=", "new").executeTakeFirst(),
		).toEqual({ site_id: "site-default" });
		expect(
			await db
				.selectFrom("_emdash_sites")
				.select("slug")
				.where("id", "=", "site-default")
				.executeTakeFirst(),
		).toEqual({ slug: "default" });
		for (const table of ["_emdash_collections", "media", "taxonomies", "options"]) {
			const column = (await db.introspection.getTables())
				.find((item) => item.name === table)
				?.columns.find((item) => item.name === "site_id");
			expect(column?.isNullable).toBe(false);
		}
	});

	if (dialect === "sqlite") {
		it("resumes after a column rename during enforcement", async () => {
			await backfill.up(ctx.db);
			await ctx.db.schema.dropIndex("idx_options_site_id").execute();
			await ctx.db.schema
				.alterTable("options")
				.renameColumn("site_id", "site_id_nullable")
				.execute();
			await enforce.up(ctx.db);
			await ctx.db.insertInto("options").values({ name: "after-retry", value: "1" }).execute();
			expect(await ctx.db.selectFrom("options").select("site_id").executeTakeFirst()).toEqual({
				site_id: "site-default",
			});
		});

		it("resumes after adding the required column", async () => {
			await ctx.db.insertInto("options").values({ name: "existing", value: "1" }).execute();
			await backfill.up(ctx.db);
			await ctx.db.schema.dropIndex("idx_options_site_id").execute();
			await ctx.db.schema
				.alterTable("options")
				.renameColumn("site_id", "site_id_nullable")
				.execute();
			await ctx.db.schema
				.alterTable("options")
				.addColumn("site_id", "text", (column) => column.notNull().defaultTo("site-default"))
				.execute();
			await enforce.up(ctx.db);
			expect(
				await ctx.db
					.selectFrom("options")
					.select("site_id")
					.where("name", "=", "existing")
					.executeTakeFirst(),
			).toEqual({ site_id: "site-default" });
		});
	}
});
