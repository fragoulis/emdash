import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runMigrations } from "../../../src/database/migrations/runner.js";
import { ContentRepository } from "../../../src/database/repositories/content.js";
import { runWithContext } from "../../../src/request-context.js";
import { SchemaRegistry } from "../../../src/schema/registry.js";
import { FTSManager } from "../../../src/search/fts-manager.js";
import { getSuggestions, searchCollection, searchWithDb } from "../../../src/search/query.js";
import { createPostFixture } from "../../utils/fixtures.js";
import {
	hasPgTestDatabase,
	createTestPostgresDatabase,
	teardownTestPostgresDatabase,
} from "../../utils/test-db.js";

const describePg = hasPgTestDatabase ? describe : describe.skip;

describePg("PostgreSQL search queries", () => {
	let ctx: Awaited<ReturnType<typeof createTestPostgresDatabase>>;
	let content: ContentRepository;
	let fts: FTSManager;

	beforeEach(async () => {
		ctx = await createTestPostgresDatabase();
		await runMigrations(ctx.db, { migrationTableSchema: ctx.schemaName });
		const registry = new SchemaRegistry(ctx.db);
		await registry.createCollection({ slug: "post", label: "Posts", labelSingular: "Post" });
		await registry.createField("post", {
			slug: "title",
			label: "Title",
			type: "string",
			searchable: true,
		});
		await registry.createField("post", {
			slug: "headline",
			label: "Headline",
			type: "string",
			searchable: true,
		});
		await registry.createField("post", {
			slug: "content",
			label: "Content",
			type: "portableText",
			searchable: true,
		});
		await registry.updateCollection("post", { titleField: "headline" });
		await registry.createCollection({ slug: "page", label: "Pages", labelSingular: "Page" });
		await registry.createField("page", { slug: "title", label: "Title", type: "string" });
		await registry.createField("page", { slug: "content", label: "Content", type: "portableText" });
		await ctx.db
			.insertInto("_emdash_sites")
			.values([
				{ id: "site-a", slug: "site-a", active: 1 },
				{ id: "site-b", slug: "site-b", active: 1 },
			])
			.execute();
		content = new ContentRepository(ctx.db);
		fts = new FTSManager(ctx.db);
		await fts.enableSearch("post", { weights: { headline: 8, content: 1, title: 1 } });
	}, 30_000);

	afterEach(async () => teardownTestPostgresDatabase(ctx), 30_000);

	async function add(
		siteId: string,
		slug: string,
		title: string,
		locale = "el",
		status = "published",
		contentValue: unknown = [],
	) {
		return runWithContext({ editMode: false, siteId }, () =>
			content.create(
				createPostFixture({
					slug,
					title,
					locale,
					status,
					data: { title, headline: title, content: contentValue },
				}),
			),
		);
	}

	it("matches Greek inflections, case, and accents using the content locale", async () => {
		await add("site-a", "greek", "ΆΝΘΡΩΠΟΣ");
		await runWithContext({ editMode: false, siteId: "site-a" }, async () => {
			const results = await searchCollection(ctx.db, "post", "άνθρωποι", { locale: "el" });
			expect(results.items.map((item) => item.slug)).toEqual(["greek"]);
			const suggestions = await getSuggestions(ctx.db, "άνθρωπ", { locale: "el" });
			expect(suggestions.map((item) => item.slug)).toEqual(["greek"]);
		});
	});

	it("keeps title weighting, Portable Text search, ranked pagination, and site isolation", async () => {
		await add("site-a", "body-hit", "A quiet title", "en", "published", [
			{ children: [{ text: "distinctive searchable passage" }] },
		]);
		await add("site-a", "title-hit", "distinctive searchable passage", "en");
		await add("site-a", "title-hit-tie", "distinctive searchable passage", "en");
		await add("site-a", "draft-title", "distinctive private passage", "en", "draft");
		await add("site-b", "other-site", "distinctive searchable passage", "en");
		await runWithContext({ editMode: false, siteId: "site-a" }, async () => {
			const all = await searchWithDb(ctx.db, "distinctive", { locale: "en", limit: 10 });
			expect(
				all.items
					.slice(0, 2)
					.map((item) => item.slug)
					.toSorted((a, b) => a.localeCompare(b)),
			).toEqual(["title-hit", "title-hit-tie"]);
			expect(all.items[0]?.title).toBe("distinctive searchable passage");
			expect(all.items[0]!.id.localeCompare(all.items[1]!.id)).toBeLessThan(0);
			const titleOnly = await searchCollection(ctx.db, "post", "distinctive", {
				locale: "en",
				scope: "title",
			});
			expect(
				titleOnly.items.map((item) => item.slug).toSorted((a, b) => a.localeCompare(b)),
			).toEqual(["title-hit", "title-hit-tie"]);
			const first = await searchWithDb(ctx.db, "distinctive", { locale: "en", limit: 1 });
			const second = await searchWithDb(ctx.db, "distinctive", {
				locale: "en",
				limit: 1,
				cursor: first.nextCursor,
			});
			const third = await searchWithDb(ctx.db, "distinctive", {
				locale: "en",
				limit: 1,
				cursor: second.nextCursor,
			});
			expect([first.items[0]?.id, second.items[0]?.id, third.items[0]?.id]).toEqual(
				all.items.map((item) => item.id),
			);
			expect(third.items[0]?.snippet).toContain("searchable passage");
			expect(third.items[0]?.snippet).not.toContain("children");
			const suggestions = await getSuggestions(ctx.db, "dist", { locale: "en" });
			expect(suggestions.map((item) => item.slug).toSorted((a, b) => a.localeCompare(b))).toEqual([
				"title-hit",
				"title-hit-tie",
			]);
		});
	});

	it("uses the simple fallback and filters to the requested content locale", async () => {
		await add("site-a", "unsupported", "running", "xx");
		await add("site-a", "locale-en", "sharedlocaleprobe", "en");
		await add("site-a", "locale-fr", "sharedlocaleprobe", "fr");
		await runWithContext({ editMode: false, siteId: "site-a" }, async () => {
			const fallback = await searchCollection(ctx.db, "post", "run");
			expect(fallback.items.map((item) => item.slug)).not.toContain("unsupported");
			const english = await searchCollection(ctx.db, "post", "sharedlocaleprobe", { locale: "en" });
			expect(english.items.map((item) => item.slug)).toEqual(["locale-en"]);
		});
	});

	it("escapes stored markup in snippets and rejects missing site context", async () => {
		await add(
			"site-a",
			"unsafe",
			"needle 2 < 3 & \uE000fake\uE001 <script>alert(1)</script>",
			"en",
		);
		await runWithContext({ editMode: false, siteId: "site-a" }, async () => {
			const result = await searchCollection(ctx.db, "post", "needle", { locale: "en" });
			expect(result.items[0]?.snippet).not.toContain("<script>");
			expect(result.items[0]?.snippet).toContain("&lt; 3 &amp;");
			expect(result.items[0]?.snippet).not.toContain("<mark>fake");
			expect(result.items[0]?.snippet?.match(/<mark>/g)?.length).toBeGreaterThan(0);
			expect(result.items[0]?.snippet?.match(/<mark>/g)?.length).toBe(
				result.items[0]?.snippet?.match(/<\/mark>/g)?.length,
			);
		});
		await fts.disableSearch("post");
		await expect(searchWithDb(ctx.db, "")).rejects.toThrow(/selected site/i);
		await expect(getSuggestions(ctx.db, "")).rejects.toThrow(/selected site/i);
	});
});
