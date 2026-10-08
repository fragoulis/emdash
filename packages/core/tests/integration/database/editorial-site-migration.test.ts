import {
	sql,
	type KyselyPlugin,
	type PluginTransformQueryArgs,
	type PluginTransformResultArgs,
	type QueryResult,
	type RootOperationNode,
	type UnknownRow,
} from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";

import { up } from "../../../src/database/migrations/096_editorial_site_ownership.js";
import { createMigrator } from "../../../src/database/migrations/runner.js";
import { UserRepository } from "../../../src/database/repositories/user.js";
import { SchemaRegistry } from "../../../src/schema/registry.js";
import {
	createForDialect,
	describeEachDialect,
	setupForDialect,
	teardownForDialect,
	type DialectTestContext,
} from "../../utils/test-db.js";

class InterruptBackfill implements KyselyPlugin {
	updates = 0;

	constructor(private readonly table: "revisions" | "_emdash_content_bylines") {}

	transformQuery({ node }: PluginTransformQueryArgs): RootOperationNode {
		const text = JSON.stringify(node);
		if (text.includes("UPDATE") && text.includes(this.table)) {
			if (this.updates === 1) throw new Error("interrupted");
			this.updates++;
		}
		return node;
	}

	transformResult({ result }: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
		return Promise.resolve(result);
	}
}

describeEachDialect("byline site uniqueness upgrade", (dialect) => {
	let ctx: DialectTestContext;

	beforeEach(async () => {
		ctx = await createForDialect(dialect);
		const { error } = await createMigrator(ctx.db, {
			migrationTableSchema: ctx.pgCtx?.schemaName,
		}).migrateTo("095_published_content_sites");
		if (error) throw error;
	});

	afterEach(async () => teardownForDialect(ctx));

	if (dialect === "sqlite") {
		it("resumes a byline rebuild after dropping the old table", async () => {
			await sql`INSERT INTO _emdash_bylines (id, slug, display_name, locale, translation_group)
				VALUES ('old', 'shared', 'Old', 'en', 'old-group')`.execute(ctx.db);
			await sql`INSERT INTO _emdash_byline_fields (id, slug, label, type)
				VALUES ('field', 'role', 'Role', 'string')`.execute(ctx.db);
			await sql`INSERT INTO _emdash_byline_field_values (byline_id, field_id, value)
				VALUES ('old', 'field', '"Author"')`.execute(ctx.db);
			const interrupt: KyselyPlugin = {
				transformQuery({ node }) {
					if (
						node.kind === "AlterTableNode" &&
						JSON.stringify(node).includes("_emdash_bylines_site_new")
					) {
						throw new Error("interrupted rename");
					}
					return node;
				},
				transformResult({ result }) {
					return Promise.resolve(result);
				},
			};
			await expect(up(ctx.db.withPlugin(interrupt))).rejects.toThrow("interrupted rename");
			await up(ctx.db);
			await up(ctx.db);
			const rows = await sql<{ id: string }>`SELECT id FROM _emdash_bylines`.execute(ctx.db);
			expect(rows.rows).toEqual([{ id: "old" }]);
			const values = await sql<{
				value: string;
			}>`SELECT value FROM _emdash_byline_field_values`.execute(ctx.db);
			expect(values.rows).toEqual([{ value: '"Author"' }]);
		});
	}

	it("preserves old bylines and field values while replacing global constraints", async () => {
		const user = await new UserRepository(ctx.db).create({ email: "old@example.com", name: "Old" });
		await sql`INSERT INTO _emdash_bylines
			(id, slug, display_name, user_id, locale, translation_group)
			VALUES ('old', 'shared', 'Old', ${user.id}, 'en', 'old-group')`.execute(ctx.db);
		await sql`INSERT INTO _emdash_byline_fields (id, slug, label, type)
			VALUES ('field', 'role', 'Role', 'string')`.execute(ctx.db);
		await sql`INSERT INTO _emdash_byline_field_values (byline_id, field_id, value)
			VALUES ('old', 'field', '"Author"')`.execute(ctx.db);
		await up(ctx.db);
		await up(ctx.db);
		await sql`INSERT INTO _emdash_sites (id, slug) VALUES ('site-bar', 'bar')`.execute(ctx.db);
		await sql`INSERT INTO _emdash_bylines
			(id, slug, display_name, user_id, locale, translation_group, site_id)
			VALUES ('new', 'shared', 'New', ${user.id}, 'en', 'old-group', 'site-bar')`.execute(ctx.db);
		const rows = await sql<{ id: string; site_id: string }>`SELECT id, site_id FROM _emdash_bylines
			ORDER BY id`.execute(ctx.db);
		expect(rows.rows).toEqual([
			{ id: "new", site_id: "site-bar" },
			{ id: "old", site_id: "site-default" },
		]);
		const values = await sql<{ value: string }>`SELECT value FROM _emdash_byline_field_values
			WHERE byline_id = 'old'`.execute(ctx.db);
		expect(values.rows).toEqual([{ value: '"Author"' }]);
	});
});

describeEachDialect("editorial site ownership upgrade", (dialect) => {
	let ctx: DialectTestContext;

	beforeEach(async () => {
		ctx = await setupForDialect(dialect);
		const registry = new SchemaRegistry(ctx.db);
		await registry.createCollection({ slug: "posts", label: "Posts", labelSingular: "Post" });
		await sql`INSERT INTO _emdash_sites (id, slug) VALUES ('site-bar', 'bar')`.execute(ctx.db);
		await sql`INSERT INTO ec_posts (id, site_id, status, locale, translation_group)
			VALUES ('bar-id', 'site-bar', 'draft', 'en', 'bar-id')`.execute(ctx.db);
		await sql`INSERT INTO revisions (id, collection, entry_id, data, site_id)
			VALUES ('revision-bar', 'posts', 'bar-id', '{}', 'site-default')`.execute(ctx.db);
		await sql`INSERT INTO _emdash_content_bylines
			(id, collection_slug, content_id, byline_id, sort_order, site_id)
			VALUES ('credit-bar', 'posts', 'bar-id', 'byline-bar', 0, 'site-default')`.execute(ctx.db);
	});

	afterEach(async () => teardownForDialect(ctx));

	it("backfills satellite rows from the owning entry and can be retried", async () => {
		await up(ctx.db);
		await up(ctx.db);
		const revision = await sql<{
			site_id: string;
		}>`SELECT site_id FROM revisions WHERE id = 'revision-bar'`.execute(ctx.db);
		const credit = await sql<{
			site_id: string;
		}>`SELECT site_id FROM _emdash_content_bylines WHERE id = 'credit-bar'`.execute(ctx.db);
		expect(revision.rows[0]?.site_id).toBe("site-bar");
		expect(credit.rows[0]?.site_id).toBe("site-bar");
	});

	it("scopes byline slug, user, and translation group uniqueness to a site after retry", async () => {
		const user = await new UserRepository(ctx.db).create({
			email: "editor@example.com",
			name: "Editor",
		});
		await sql`INSERT INTO _emdash_bylines
			(id, slug, display_name, user_id, locale, translation_group, site_id)
			VALUES ('existing', 'editor', 'Editor', ${user.id}, 'en', 'group', 'site-default')`.execute(
			ctx.db,
		);
		await up(ctx.db);
		await up(ctx.db);
		await sql`INSERT INTO _emdash_bylines
			(id, slug, display_name, user_id, locale, translation_group, site_id)
			VALUES ('bar', 'editor', 'Bar Editor', ${user.id}, 'en', 'group', 'site-bar')`.execute(
			ctx.db,
		);
		const count = await sql<{
			count: number | string;
		}>`SELECT COUNT(*) AS count FROM _emdash_bylines
			WHERE slug = 'editor'`.execute(ctx.db);
		expect(Number(count.rows[0]?.count)).toBe(2);
		for (const [id, slug, userId, group] of [
			["duplicate-slug", "editor", null, "other-group"],
			["duplicate-user", "other-slug", user.id, "other-group"],
			["duplicate-group", "other-slug", null, "group"],
		] as const) {
			await expect(
				sql`INSERT INTO _emdash_bylines
				(id, slug, display_name, user_id, locale, translation_group, site_id)
				VALUES (${id}, ${slug}, 'Duplicate', ${userId}, 'en', ${group}, 'site-bar')`.execute(
					ctx.db,
				),
			).rejects.toThrow();
		}
		await up(ctx.db);
	});

	it("backfills a large collection in bounded statements after an interrupted batch", async () => {
		const ids = Array.from(
			{ length: 230 },
			(_, index) => `entry-${String(index).padStart(4, "0")}`,
		);
		for (let offset = 0; offset < ids.length; offset += 20) {
			const batch = ids.slice(offset, offset + 20);
			await sql`INSERT INTO ec_posts (id, site_id, status, locale, translation_group) VALUES ${sql.join(
				batch.map((id) => sql`(${id}, 'site-bar', 'draft', 'en', ${id})`),
			)}`.execute(ctx.db);
			await sql`INSERT INTO revisions (id, collection, entry_id, data, site_id) VALUES ${sql.join(
				batch.map((id) => sql`(${`rev-${id}`}, 'posts', ${id}, '{}', 'site-default')`),
			)}`.execute(ctx.db);
			await sql`INSERT INTO _emdash_content_bylines
				(id, collection_slug, content_id, byline_id, sort_order, site_id) VALUES ${sql.join(
					batch.map(
						(id) => sql`(${`credit-${id}`}, 'posts', ${id}, 'byline-bar', 0, 'site-default')`,
					),
				)}`.execute(ctx.db);
		}

		const interrupt = new InterruptBackfill("revisions");
		await expect(up(ctx.db.withPlugin(interrupt))).rejects.toThrow("interrupted");
		const partial = await sql<{ count: number | string }>`SELECT COUNT(*) AS count FROM revisions
			WHERE site_id = 'site-bar' AND collection = 'posts'`.execute(ctx.db);
		expect(Number(partial.rows[0]?.count)).toBeGreaterThan(0);
		expect(Number(partial.rows[0]?.count)).toBeLessThanOrEqual(50);

		const interruptCredits = new InterruptBackfill("_emdash_content_bylines");
		await expect(up(ctx.db.withPlugin(interruptCredits))).rejects.toThrow("interrupted");
		const partialCredits = await sql<{ count: number | string }>`SELECT COUNT(*) AS count
			FROM _emdash_content_bylines WHERE site_id = 'site-bar'`.execute(ctx.db);
		expect(Number(partialCredits.rows[0]?.count)).toBeGreaterThan(0);
		expect(Number(partialCredits.rows[0]?.count)).toBeLessThanOrEqual(50);

		await up(ctx.db);
		await up(ctx.db);
		for (const table of ["revisions", "_emdash_content_bylines"]) {
			const remaining = await sql<{ count: number | string }>`SELECT COUNT(*) AS count
				FROM ${sql.ref(table)} WHERE site_id != 'site-bar'`.execute(ctx.db);
			expect(Number(remaining.rows[0]?.count)).toBe(0);
			const migrated = await sql<{ count: number | string }>`SELECT COUNT(*) AS count
				FROM ${sql.ref(table)} WHERE site_id = 'site-bar'`.execute(ctx.db);
			expect(Number(migrated.rows[0]?.count)).toBe(ids.length + 1);
		}
	});
});
