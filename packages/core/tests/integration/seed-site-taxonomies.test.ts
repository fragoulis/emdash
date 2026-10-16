import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { up as migrateTaxonomies } from "../../src/database/migrations/098_site_taxonomies.js";
import { TaxonomyRepository } from "../../src/database/repositories/taxonomy.js";
import { runWithContext } from "../../src/request-context.js";
import { applySeed } from "../../src/seed/apply.js";
import type { SeedFile } from "../../src/seed/types.js";
import { getEntryTerms, getTaxonomyTerms } from "../../src/taxonomies/index.js";
import { setupTestDatabase, teardownTestDatabase } from "../utils/test-db.js";

describe("site-owned starter terms", () => {
	let db: Awaited<ReturnType<typeof setupTestDatabase>>;
	const seed: SeedFile = {
		version: "1",
		collections: [
			{
				slug: "posts",
				label: "Posts",
				fields: [{ slug: "title", label: "Title", type: "string" }],
			},
		],
		taxonomies: [
			{
				name: "category",
				label: "Categories",
				hierarchical: false,
				collections: ["posts"],
				terms: [{ slug: "news", label: "News" }],
			},
		],
		bylines: [{ id: "writer", slug: "writer", displayName: "Writer" }],
		content: {
			posts: [
				{
					id: "post",
					slug: "post",
					status: "published",
					data: { title: "Post" },
					taxonomies: { category: ["news"] },
					bylines: [{ byline: "writer" }],
				},
			],
		},
	};

	beforeEach(async () => {
		db = await setupTestDatabase();
	});
	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	it("seeds two sites separately and preserves their own assignments on retry", async () => {
		await sql`INSERT INTO _emdash_sites (id, slug) VALUES ('site-other', 'other')`.execute(db);
		const apply = (siteId: string) =>
			runWithContext({ editMode: false, siteId }, () =>
				applySeed(db, seed, { includeContent: true }),
			);
		await apply("site-default");
		await apply("site-other");
		await migrateTaxonomies(db);
		await apply("site-other");
		const terms = await sql<{
			site_id: string;
			id: string;
			translation_group: string;
		}>`SELECT site_id, id, translation_group FROM taxonomies WHERE name = 'category' AND slug = 'news' ORDER BY site_id`.execute(
			db,
		);
		expect(terms.rows.map((row) => row.site_id)).toEqual(["site-default", "site-other"]);
		expect(terms.rows[0]?.id).not.toBe(terms.rows[1]?.id);
		const assignments = await sql<{
			site_id: string;
			taxonomy_id: string;
		}>`SELECT site_id, taxonomy_id FROM content_taxonomies WHERE collection = 'posts' ORDER BY site_id`.execute(
			db,
		);
		const otherPost = await sql<{
			id: string;
		}>`SELECT id FROM ec_posts WHERE site_id = 'site-other'`.execute(db);
		const otherRepo = new TaxonomyRepository(db, "site-other");
		await expect(
			otherRepo.attachGroupsToEntry("posts", otherPost.rows[0]!.id, [
				terms.rows[0]!.translation_group,
			]),
		).rejects.toThrow("selected site");
		expect(assignments.rows).toEqual(
			terms.rows.map((row) => ({ site_id: row.site_id, taxonomy_id: row.translation_group })),
		);
		const bylines = await sql<{
			site_id: string;
		}>`SELECT site_id FROM _emdash_bylines WHERE slug = 'writer' ORDER BY site_id`.execute(db);
		expect(bylines.rows.map((row) => row.site_id)).toEqual(["site-default", "site-other"]);
		for (const siteId of ["site-default", "site-other"]) {
			const post = await sql<{
				id: string;
			}>`SELECT id FROM ec_posts WHERE site_id = ${siteId}`.execute(db);
			const termsForSite = await runWithContext({ editMode: false, siteId, db }, async () => ({
				list: await getTaxonomyTerms("category", { includeCounts: false }),
				assigned: await getEntryTerms("posts", post.rows[0]!.id, "category"),
			}));
			expect(termsForSite.list.map((term) => term.id)).toEqual([
				terms.rows.find((term) => term.site_id === siteId)!.id,
			]);
			expect(termsForSite.assigned.map((term) => term.id)).toEqual([
				terms.rows.find((term) => term.site_id === siteId)!.id,
			]);
		}
		await expect(
			runWithContext({ editMode: false }, () =>
				getTaxonomyTerms("category", { includeCounts: false }),
			),
		).rejects.toThrow("server-selected site");
	});
});
