import type { KyselyPlugin } from "kysely";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { up as migratePostgresSearchIndex } from "../../../src/database/migrations/104_postgres_search_index.js";
import { ContentRepository } from "../../../src/database/repositories/content.js";
import { runWithContext } from "../../../src/request-context.js";
import { SchemaRegistry } from "../../../src/schema/registry.js";
import { FTSManager } from "../../../src/search/fts-manager.js";
import { PostgresSearchIndex } from "../../../src/search/postgres-index.js";
import { createPostFixture } from "../../utils/fixtures.js";
import {
	hasPgTestDatabase,
	setupTestDatabase,
	setupTestPostgresDatabaseWithCollections,
	teardownTestDatabase,
	teardownTestPostgresDatabase,
} from "../../utils/test-db.js";

const describePg = hasPgTestDatabase ? describe : describe.skip;

describe("SQLite site-scoped index maintenance", () => {
	it("rebuilds and reports only the selected site's FTS rows", async () => {
		const db = await setupTestDatabase();
		try {
			await db
				.insertInto("_emdash_sites")
				.values([
					{ id: "site-a", slug: "a" },
					{ id: "site-b", slug: "b" },
				])
				.execute();
			const registry = new SchemaRegistry(db);
			await registry.createCollection({ slug: "article", label: "Articles", supports: ["search"] });
			await registry.createField("article", {
				slug: "title",
				label: "Title",
				type: "string",
				searchable: true,
			});
			const fts = new FTSManager(db);
			await fts.enableSearch("article");
			const content = new ContentRepository(db);
			for (const siteId of ["site-a", "site-b"]) {
				await runWithContext({ editMode: false, siteId }, () =>
					content.create({
						type: "article",
						slug: siteId,
						status: "published",
						data: { title: `${siteId} content` },
					}),
				);
			}
			await runWithContext({ editMode: false, siteId: "site-a" }, async () => {
				await fts.rebuildIndex("article", ["title"]);
				expect((await fts.getIndexStats("article"))?.indexed).toBe(1);
			});
			await runWithContext({ editMode: false, siteId: "site-b" }, async () => {
				expect((await fts.getIndexStats("article"))?.indexed).toBe(1);
			});
			await expect(fts.getIndexStats("article")).rejects.toThrow(/selected site/i);
		} finally {
			await teardownTestDatabase(db);
		}
	});
});

describePg("PostgreSQL search index lifecycle", () => {
	let ctx: Awaited<ReturnType<typeof setupTestPostgresDatabaseWithCollections>>;
	let content: ContentRepository;
	let fts: FTSManager;

	beforeEach(async () => {
		ctx = await setupTestPostgresDatabaseWithCollections();
		await ctx.db
			.insertInto("_emdash_sites")
			.values([
				{ id: "site-a", slug: "a" },
				{ id: "site-b", slug: "b" },
			])
			.execute();
		content = new ContentRepository(ctx.db);
		fts = new FTSManager(ctx.db);
		const registry = new SchemaRegistry(ctx.db);
		await registry.updateCollection("post", { supports: ["drafts", "revisions", "search"] });
		await registry.updateField("post", "title", { searchable: true });
		await registry.updateField("post", "content", { searchable: true });
		await fts.enableSearch("post");
	});

	afterEach(async () => teardownTestPostgresDatabase(ctx));

	async function add(siteId: string, slug: string, title: string) {
		return runWithContext({ editMode: false, siteId }, () =>
			content.create(
				createPostFixture({
					slug,
					title,
					data: {
						title,
						content: [
							{
								_key: "metadata-secret",
								style: "private-style",
								children: [
									{ _key: "child-secret", text: "portable phrase", marks: ["mark-secret"] },
								],
							},
							{ alt: "image alt phrase", caption: "image caption phrase" },
						],
					},
				}),
			),
		);
	}

	it("maintains vectors on writes and keeps rebuild and statistics site-scoped", async () => {
		const aItem = await add("site-a", "a-entry", "ΆΝΘΡΩΠΟΣ");
		await add("site-b", "b-entry", "άνθρωποι");
		const index = new PostgresSearchIndex(ctx.db);
		const siteA = await index.getCollectionStats("post", { kind: "site", siteId: "site-a" });
		const siteB = await index.getCollectionStats("post", { kind: "site", siteId: "site-b" });
		expect(siteA?.indexed).toBe(1);
		expect(siteB?.indexed).toBe(1);
		const vectors = await ctx.db
			.selectFrom("_emdash_search_post")
			.select(["site_id", "search_vector", "title_vector", "field_vectors"])
			.orderBy("site_id")
			.execute();
		expect(vectors).toHaveLength(2);
		expect(String(vectors[0]?.search_vector)).toContain("άνθρωποσ");
		const fields = JSON.stringify(vectors[0]?.field_vectors);
		expect(fields).toContain("portabl");
		expect(fields).toContain("imag");
		expect(fields).not.toContain("metadata-secret");
		expect(fields).not.toContain("child-secret");
		expect(fields).not.toContain("private-style");
		expect(fields).not.toContain("mark-secret");

		await runWithContext({ editMode: false, siteId: "site-a" }, async () => {
			await content.update("post", aItem.id, { data: { title: "updated phrase", content: [] } });
		});
		const updated = await ctx.db
			.selectFrom("_emdash_search_post")
			.select("search_vector")
			.where("site_id", "=", "site-a")
			.executeTakeFirstOrThrow();
		expect(String(updated.search_vector)).toContain("updat");
		await ctx.db
			.updateTable("ec_post")
			.set({ title: "direct sql change", status: "draft" })
			.where("id", "=", aItem.id)
			.execute();
		const directUpdate = await ctx.db
			.selectFrom("_emdash_search_post")
			.select("search_vector")
			.where("site_id", "=", "site-a")
			.executeTakeFirstOrThrow();
		expect(String(directUpdate.search_vector)).toContain("direct");
		expect(String(directUpdate.search_vector)).not.toContain("updat");
		await ctx.db
			.updateTable("ec_post")
			.set({ status: "published" })
			.where("id", "=", aItem.id)
			.execute();
		expect(
			(
				await new PostgresSearchIndex(ctx.db).getCollectionStats("post", {
					kind: "site",
					siteId: "site-a",
				})
			)?.indexed,
		).toBe(1);

		await ctx.db
			.updateTable("_emdash_search_post")
			.set({ search_vector: sql`'untouched'::tsvector` })
			.where("site_id", "=", "site-b")
			.execute();
		await runWithContext({ editMode: false, siteId: "site-a" }, async () => {
			await fts.rebuildIndex("post", await fts.getSearchableFields("post"));
			expect((await fts.getIndexStats("post"))?.indexed).toBe(1);
		});
		const untouched = await ctx.db
			.selectFrom("_emdash_search_post")
			.select("search_vector")
			.where("site_id", "=", "site-b")
			.executeTakeFirstOrThrow();
		expect(String(untouched.search_vector)).toBe("'untouched'");
		await runWithContext({ editMode: false, siteId: "site-b" }, async () => {
			expect((await fts.getIndexStats("post"))?.indexed).toBe(1);
		});
		await expect(fts.rebuildIndex("post", await fts.getSearchableFields("post"))).rejects.toThrow(
			/selected site/i,
		);
		await expect(fts.getIndexStats("post")).rejects.toThrow(/selected site/i);
	});

	it("keeps edits made during a paused rebuild from being overwritten", async () => {
		const item = await add("site-a", "rebuild-race", "stale emerald");
		const deletedItem = await add("site-a", "rebuild-delete-race", "stale deletedword");
		let batchRead!: () => void;
		let releaseBatch!: () => void;
		const readReady = new Promise<void>((resolve) => (batchRead = resolve));
		const batchGate = new Promise<void>((resolve) => (releaseBatch = resolve));
		let paused = false;
		const plugin: KyselyPlugin = {
			transformQuery(args) {
				return args.node;
			},
			async transformResult(args) {
				if (
					!paused &&
					args.result.rows.some(
						(row) =>
							(row.id === item.id && row.title === "stale emerald") ||
							(row.id === deletedItem.id && row.title === "stale deletedword"),
					)
				) {
					paused = true;
					batchRead();
					await batchGate;
				}
				return args.result;
			},
		};
		const rebuild = new PostgresSearchIndex(ctx.db.withPlugin(plugin)).rebuildCollection("post", {
			kind: "site",
			siteId: "site-a",
		});
		let updateDone = false;
		let update: Promise<unknown> | undefined;
		let observedUpdateState = false;
		try {
			await readReady;
			update = ctx.db
				.transaction()
				.execute(async (trx) => {
					await sql`SET LOCAL application_name = 'ticket64-rebuild-race-update'`.execute(trx);
					await trx
						.updateTable("ec_post")
						.set({ title: "fresh sapphire" })
						.where("id", "=", item.id)
						.execute();
					await trx
						.updateTable("ec_post")
						.set({ deleted_at: new Date().toISOString() })
						.where("id", "=", deletedItem.id)
						.execute();
				})
				.finally(() => {
					updateDone = true;
				});
			const deadline = Date.now() + 10_000;
			while (Date.now() < deadline) {
				if (updateDone) break;
				const waiting = await sql<{ waiting: boolean }>`SELECT EXISTS (
					SELECT 1 FROM pg_stat_activity
					WHERE application_name = 'ticket64-rebuild-race-update' AND wait_event_type = 'Lock'
				) AS waiting`.execute(ctx.db);
				if (waiting.rows[0]?.waiting) {
					observedUpdateState = true;
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			observedUpdateState ||= updateDone;
		} finally {
			releaseBatch();
			await Promise.all([rebuild, update]);
		}
		expect(observedUpdateState).toBe(true);

		const vector = await ctx.db
			.selectFrom("_emdash_search_post")
			.select("search_vector")
			.where("site_id", "=", "site-a")
			.where("content_id", "=", item.id)
			.executeTakeFirstOrThrow();
		expect(String(vector.search_vector)).toContain("sapphir");
		expect(String(vector.search_vector)).not.toContain("emerald");
		const deletedVector = await ctx.db
			.selectFrom("_emdash_search_post")
			.select("content_id")
			.where("site_id", "=", "site-a")
			.where("content_id", "=", deletedItem.id)
			.executeTakeFirst();
		expect(deletedVector).toBeUndefined();
	});

	it("weights the configured custom title field rather than a literal title field", async () => {
		const registry = new SchemaRegistry(ctx.db);
		await registry.createField("post", {
			slug: "headline",
			label: "Headline",
			type: "string",
			searchable: true,
		});
		await registry.updateCollection("post", { titleField: "headline" });
		const item = await runWithContext({ editMode: false, siteId: "site-a" }, () =>
			content.create(
				createPostFixture({
					slug: "custom-title",
					title: "ordinary body",
					data: { title: "ordinary body", headline: "special headline" },
				}),
			),
		);
		const row = await ctx.db
			.selectFrom("_emdash_search_post")
			.select(["search_vector", "title_vector"])
			.where("content_id", "=", item.id)
			.executeTakeFirstOrThrow();
		expect(String(row.title_vector)).toContain("special");
		expect(String(row.title_vector)).not.toContain("ordinari");
		expect(String(row.search_vector)).toMatch(/'special':\d+A/);
		expect(String(row.search_vector)).toMatch(/'ordinari':\d+B/);
	});

	it("rebuilds existing title vectors when the collection title field changes", async () => {
		const registry = new SchemaRegistry(ctx.db);
		await registry.createField("post", {
			slug: "headline",
			label: "Headline",
			type: "string",
			searchable: true,
		});
		const item = await runWithContext({ editMode: false, siteId: "site-a" }, () =>
			content.create(
				createPostFixture({
					slug: "title-field-change",
					title: "regular title",
					data: {
						title: "regular title",
						headline: "custom headline",
						content: [{ children: [{ text: "body" }] }],
					},
				}),
			),
		);

		await registry.updateCollection("post", { titleField: "headline" });

		const vectors = await ctx.db
			.selectFrom("_emdash_search_post")
			.select(["title_vector", "search_vector"])
			.where("content_id", "=", item.id)
			.executeTakeFirstOrThrow();
		expect(String(vectors.title_vector)).toContain("custom");
		expect(String(vectors.title_vector)).not.toContain("regular");
	});

	it("removes soft-deleted content from the index", async () => {
		const item = await add("site-a", "trash-me", "searchable title");
		await runWithContext({ editMode: false, siteId: "site-a" }, async () => {
			await content.delete("post", item.id);
		});
		const stats = await new PostgresSearchIndex(ctx.db).getCollectionStats("post", {
			kind: "site",
			siteId: "site-a",
		});
		expect(stats?.indexed).toBe(0);
		await runWithContext({ editMode: false, siteId: "site-a" }, async () => {
			await content.restore("post", item.id);
		});
		expect(
			(
				await new PostgresSearchIndex(ctx.db).getCollectionStats("post", {
					kind: "site",
					siteId: "site-a",
				})
			)?.indexed,
		).toBe(1);
		await ctx.db.deleteFrom("ec_post").where("id", "=", item.id).execute();
		expect(
			(
				await new PostgresSearchIndex(ctx.db).getCollectionStats("post", {
					kind: "site",
					siteId: "site-a",
				})
			)?.indexed,
		).toBe(0);
	});

	it("backfills existing enabled content and safely repeats migration initialization", async () => {
		await add("site-a", "before-index", "existing search content");
		await fts.setSearchConfig("post", { enabled: true });
		await migratePostgresSearchIndex(ctx.db);
		await migratePostgresSearchIndex(ctx.db);
		const stats = await new PostgresSearchIndex(ctx.db).getCollectionStats("post", {
			kind: "site",
			siteId: "site-a",
		});
		expect(stats?.indexed).toBe(1);
	});
});
