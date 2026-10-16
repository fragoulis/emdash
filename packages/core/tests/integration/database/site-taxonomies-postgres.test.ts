import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as migration from "../../../src/database/migrations/098_site_taxonomies.js";
import { createMigrator } from "../../../src/database/migrations/runner.js";
import { TaxonomyRepository } from "../../../src/database/repositories/taxonomy.js";
import {
	createTestPostgresDatabase,
	hasPgTestDatabase,
	setupTestPostgresDatabaseWithCollections,
	teardownTestPostgresDatabase,
	type PgTestContext,
} from "../../utils/test-db.js";

describe.skipIf(!hasPgTestDatabase)("PostgreSQL taxonomy site ownership", () => {
	let ctx: PgTestContext;

	afterEach(async () => {
		await teardownTestPostgresDatabase(ctx);
	});

	it("upgrades existing terms and assignments and permits a repeat run", async () => {
		ctx = await createTestPostgresDatabase();
		const { error } = await createMigrator(ctx.db, {
			migrationTableSchema: ctx.schemaName,
		}).migrateTo("097_site_settings");
		if (error) throw error;
		await sql`INSERT INTO taxonomies (id, name, slug, label, translation_group)
			VALUES ('old-term', 'tags', 'shared', 'Old', 'old-term')`.execute(ctx.db);
		await sql`INSERT INTO content_taxonomies (collection, entry_id, taxonomy_id)
			VALUES ('post', 'old-entry', 'old-term')`.execute(ctx.db);

		await migration.up(ctx.db);
		await migration.up(ctx.db);
		expect(
			(await sql`SELECT site_id FROM taxonomies WHERE id = 'old-term'`.execute(ctx.db)).rows,
		).toEqual([{ site_id: "site-default" }]);
		expect((await sql`SELECT site_id FROM content_taxonomies`.execute(ctx.db)).rows).toEqual([
			{ site_id: "site-default" },
		]);
		await expect(
			sql`INSERT INTO content_taxonomies (collection, entry_id, taxonomy_id)
			VALUES ('post', 'new-entry', 'old-term')`.execute(ctx.db),
		).rejects.toThrow();
		await expect(
			sql`INSERT INTO taxonomies (id, name, slug, label)
			VALUES ('new-term', 'tags', 'new', 'New')`.execute(ctx.db),
		).rejects.toThrow();
	}, 30000);

	describe("two sites with shared definitions", () => {
		beforeEach(async () => {
			ctx = await setupTestPostgresDatabaseWithCollections();
			await sql`INSERT INTO _emdash_sites (id, slug) VALUES ('site-foo', 'foo'), ('site-bar', 'bar')`.execute(
				ctx.db,
			);
			await sql`INSERT INTO _emdash_taxonomy_def_groups (id, name, hierarchical, collections)
				VALUES ('tags-def', 'tags', 1, '["post"]')`.execute(ctx.db);
			await sql`INSERT INTO _emdash_taxonomy_defs
				(id, name, label, label_singular, hierarchical, collections, locale, translation_group)
				VALUES ('tags-def', 'tags', 'Tags', 'Tag', 1, '["post"]', 'en', 'tags-def')`.execute(
				ctx.db,
			);
			await sql`INSERT INTO ec_post (id, site_id, slug, locale, translation_group)
				VALUES ('foo-entry', 'site-foo', 'shared', 'en', 'foo-entry'),
				('bar-entry', 'site-bar', 'shared', 'en', 'bar-entry')`.execute(ctx.db);
		});

		it("isolates slugs, hierarchies, translations, and entry assignments", async () => {
			expect(() => new TaxonomyRepository(ctx.db)).toThrow(/server-selected site/);
			expect(() => new TaxonomyRepository(ctx.db, "")).toThrow(/server-selected site/);
			const foo = new TaxonomyRepository(ctx.db, "site-foo");
			const bar = new TaxonomyRepository(ctx.db, "site-bar");
			const fooParent = await foo.create({ name: "tags", slug: "shared", label: "Foo" });
			const barParent = await bar.create({ name: "tags", slug: "shared", label: "Bar" });
			await expect(
				bar.create({ name: "tags", slug: "shared", label: "Duplicate" }),
			).rejects.toThrow();
			const fooChild = await foo.create({
				name: "tags",
				slug: "child",
				label: "Foo child",
				parentId: fooParent.id,
			});
			const barChild = await bar.create({
				name: "tags",
				slug: "child",
				label: "Bar child",
				parentId: barParent.id,
			});
			const fooFr = await foo.create({
				name: "tags",
				slug: "partage",
				label: "Foo FR",
				locale: "fr",
				translationOf: fooParent.id,
			});
			const barFr = await bar.create({
				name: "tags",
				slug: "partage",
				label: "Bar FR",
				locale: "fr",
				translationOf: barParent.id,
			});
			await foo.setTermsForEntry("post", "foo-entry", "tags", [fooParent.id]);
			await bar.setTermsForEntry("post", "bar-entry", "tags", [barParent.id]);

			expect((await foo.findByName("tags", { locale: "en" })).map((t) => t.id)).toEqual([
				fooParent.id,
				fooChild.id,
			]);
			expect((await bar.findChildren(barParent.id)).map((t) => t.id)).toEqual([barChild.id]);
			expect((await foo.findChildren(fooParent.id)).map((t) => t.id)).toEqual([fooChild.id]);
			expect((await foo.findTranslations(fooParent.translationGroup!)).map((t) => t.id)).toEqual([
				fooParent.id,
				fooFr.id,
			]);
			expect((await bar.findTranslations(barParent.translationGroup!)).map((t) => t.id)).toEqual([
				barParent.id,
				barFr.id,
			]);
			expect(
				(await foo.getTermsForEntry("post", "foo-entry", "tags", "fr")).map((t) => t.id),
			).toEqual([fooFr.id]);
			expect(
				(await bar.getTermsForEntry("post", "bar-entry", "tags", "en")).map((t) => t.id),
			).toEqual([barParent.id]);
			expect(await foo.findById(barParent.id)).toBeNull();
			expect(await foo.getTermsForEntry("post", "bar-entry")).toEqual([]);
			expect(await foo.countEntriesWithTerm(barParent.id)).toBe(0);
			expect(
				await foo.attachGroupsToEntry("post", "bar-entry", [fooParent.translationGroup!]),
			).toBe(0);
			await expect(
				foo.attachGroupsToEntry("post", "foo-entry", [barParent.translationGroup!]),
			).rejects.toThrow(/selected site/);
			await expect(foo.attachToEntry("post", "foo-entry", barParent.id)).rejects.toThrow(
				/selected site/,
			);
			await expect(
				foo.setTermsForEntry("post", "foo-entry", "tags", [barParent.id]),
			).rejects.toThrow(/selected site/);
			expect(
				(await foo.getTermsForEntry("post", "foo-entry", "tags", "en")).map((t) => t.id),
			).toEqual([fooParent.id]);
			await foo.setTermsForEntry("post", "bar-entry", "tags", [fooParent.id]);
			expect(
				(await bar.getTermsForEntry("post", "bar-entry", "tags", "en")).map((t) => t.id),
			).toEqual([barParent.id]);
			await expect(
				foo.create({
					name: "tags",
					slug: "foreign-child",
					label: "Foreign",
					parentId: barParent.id,
				}),
			).rejects.toThrow();
			await expect(
				foo.create({
					name: "tags",
					slug: "foreign-fr",
					label: "Foreign FR",
					locale: "fr",
					translationOf: barParent.id,
				}),
			).rejects.toThrow();
			await expect(foo.update(fooChild.id, { parentId: barParent.id })).rejects.toThrow();
			expect((await foo.findById(fooChild.id))?.parentId).toBe(fooParent.translationGroup);
		}, 30000);
	});
});
