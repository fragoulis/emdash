import { sql } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";

import { emdashLoader, loadEntriesByGroups, resetTaxonomyNamesCache } from "../../../src/loader.js";
import { getPublishedDates, getTranslations } from "../../../src/query.js";
import { runWithContext } from "../../../src/request-context.js";
import { SchemaRegistry } from "../../../src/schema/registry.js";
import {
	describeEachDialect,
	setupForDialect,
	teardownForDialect,
	type DialectTestContext,
} from "../../utils/test-db.js";

describeEachDialect("published content sites", (dialect) => {
	let ctx: DialectTestContext;

	beforeEach(async () => {
		ctx = await setupForDialect(dialect);
		const registry = new SchemaRegistry(ctx.db);
		await registry.createCollection({ slug: "posts", label: "Posts", labelSingular: "Post" });
		await registry.createField("posts", { slug: "title", label: "Title", type: "string" });
		await sql`INSERT INTO _emdash_sites (id, slug) VALUES ('site-foo', 'foo'), ('site-bar', 'bar')`.execute(
			ctx.db,
		);
		await sql`INSERT INTO ec_posts (id, site_id, slug, status, locale, translation_group, title)
		VALUES ('foo-id', 'site-foo', 'shared', 'published', 'en', 'foo-id', 'Foo'),
		('bar-id', 'site-bar', 'shared', 'published', 'en', 'bar-id', 'Bar')`.execute(ctx.db);
	});

	afterEach(async () => {
		await teardownForDialect(ctx);
	});

	function within<T>(siteId: string, fn: () => Promise<T>): Promise<T> {
		return runWithContext({ editMode: false, db: ctx.db, siteId }, fn);
	}

	it("published reads return only the selected site's rows", async () => {
		const loader = emdashLoader();
		for (const [siteId, expectedId, otherId] of [
			["site-foo", "foo-id", "bar-id"],
			["site-bar", "bar-id", "foo-id"],
		] as const) {
			const list = await within(siteId, () => loader.loadCollection({ filter: { type: "posts" } }));
			expect(list.error).toBeUndefined();
			expect(list.entries?.map((entry) => entry.data.title)).toEqual([
				siteId === "site-foo" ? "Foo" : "Bar",
			]);
			const bySlug = await within(siteId, () =>
				loader.loadEntry({ filter: { type: "posts", id: "shared" } }),
			);
			expect(bySlug && "data" in bySlug ? bySlug.data.title : null).toBe(
				siteId === "site-foo" ? "Foo" : "Bar",
			);
			const byId = await within(siteId, () =>
				loader.loadEntry({ filter: { type: "posts", id: otherId } }),
			);
			expect(byId && "data" in byId ? byId.data : null).toBeNull();
			const groups = await within(siteId, () =>
				loadEntriesByGroups("posts", [expectedId, otherId]),
			);
			expect(groups.map((entry) => entry.data.title)).toEqual([
				siteId === "site-foo" ? "Foo" : "Bar",
			]);
			const ownTranslations = await within(siteId, () => getTranslations("posts", expectedId));
			expect(ownTranslations.translations.map((entry) => entry.id)).toEqual([expectedId]);
			const deniedTranslations = await within(siteId, () => getTranslations("posts", otherId));
			expect(deniedTranslations.translations).toEqual([]);
		}
		const unknown = await within("missing", () =>
			loader.loadCollection({ filter: { type: "posts" } }),
		);
		expect(unknown.entries).toEqual([]);
		await expect(
			sql`INSERT INTO ec_posts (id, site_id, slug) VALUES ('orphan', 'missing', 'orphan')`.execute(
				ctx.db,
			),
		).rejects.toThrow();
	});

	it("taxonomy listings stay within the site for indexed and temporary sorts", async () => {
		await sql`UPDATE _emdash_taxonomy_def_groups SET collections = '["posts"]' WHERE name = 'category'`.execute(
			ctx.db,
		);
		await sql`INSERT INTO taxonomies (id, name, slug, label, translation_group)
			VALUES ('term-1', 'category', 'news', 'News', 'term-1')`.execute(ctx.db);
		await sql`INSERT INTO content_taxonomies (collection, entry_id, taxonomy_id)
			VALUES ('posts', 'foo-id', 'term-1'), ('posts', 'bar-id', 'term-1')`.execute(ctx.db);
		resetTaxonomyNamesCache();
		const loader = emdashLoader();
		for (const orderBy of [{ created_at: "desc" }, { updated_at: "desc" }] as const) {
			for (const [siteId, title] of [
				["site-foo", "Foo"],
				["site-bar", "Bar"],
			] as const) {
				const result = await within(siteId, () =>
					loader.loadCollection({
						filter: { type: "posts", where: { category: "news" }, orderBy },
					}),
				);
				expect(result.error).toBeUndefined();
				expect(result.entries?.map((entry) => entry.data.title)).toEqual([title]);
			}
		}
	});

	it("publication dates do not cross site boundaries", async () => {
		await sql`UPDATE ec_posts SET published_at = '2026-01-02' WHERE id = 'foo-id'`.execute(ctx.db);
		await sql`UPDATE ec_posts SET published_at = '2026-02-03' WHERE id = 'bar-id'`.execute(ctx.db);
		const foo = await within("site-foo", () => getPublishedDates("posts"));
		const bar = await within("site-bar", () => getPublishedDates("posts"));
		expect(foo.dates.map((date) => date.toISOString().slice(0, 10))).toEqual(["2026-01-02"]);
		expect(bar.dates.map((date) => date.toISOString().slice(0, 10))).toEqual(["2026-02-03"]);
	});
});
