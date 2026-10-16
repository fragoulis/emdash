import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { up } from "../../../src/database/migrations/098_site_taxonomies.js";
import { createTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

describe("taxonomy site ownership upgrade", () => {
	const dbs: ReturnType<typeof createTestDatabase>[] = [];
	afterEach(async () => {
		for (const db of dbs) await teardownTestDatabase(db);
		dbs.length = 0;
	});

	it("keeps old terms and content assignments across a retry", async () => {
		const db = createTestDatabase();
		dbs.push(db);
		await sql`CREATE TABLE taxonomies (
			id text PRIMARY KEY, name text NOT NULL, slug text NOT NULL, label text NOT NULL,
			parent_id text, data text, locale text NOT NULL DEFAULT 'en', translation_group text,
			sort_order integer NOT NULL DEFAULT 0, site_id text NOT NULL DEFAULT 'site-default',
			CONSTRAINT taxonomies_name_slug_locale_unique UNIQUE (name, slug, locale)
		)`.execute(db);
		await sql`CREATE TABLE content_taxonomies (
			collection text NOT NULL, entry_id text NOT NULL, taxonomy_id text NOT NULL,
			status text, scheduled_at text, deleted_at text, locale text, published_at text, created_at text,
			PRIMARY KEY (collection, entry_id, taxonomy_id)
		)`.execute(db);
		await sql`CREATE TABLE ec_posts (id text PRIMARY KEY, translation_group text, site_id text NOT NULL)`.execute(
			db,
		);
		await sql`INSERT INTO taxonomies (id, name, slug, label, translation_group) VALUES ('t1', 'category', 'news', 'News', 't1')`.execute(
			db,
		);
		await sql`INSERT INTO ec_posts (id, translation_group, site_id) VALUES ('p1', 'p1', 'site-default')`.execute(
			db,
		);
		await sql`INSERT INTO content_taxonomies (collection, entry_id, taxonomy_id) VALUES ('posts', 'p1', 't1')`.execute(
			db,
		);
		await sql`WITH RECURSIVE numbers(n) AS (
			SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 1200
		) INSERT INTO ec_posts (id, translation_group, site_id)
		SELECT 'bulk-' || n, 'bulk-' || n, 'site-default' FROM numbers`.execute(db);
		await sql`INSERT INTO content_taxonomies (collection, entry_id, taxonomy_id)
		SELECT 'posts', translation_group, 't1' FROM ec_posts WHERE id != 'p1'`.execute(db);
		await sql`CREATE TABLE content_taxonomies_site_new (
			site_id text NOT NULL, collection text NOT NULL, entry_id text NOT NULL,
			taxonomy_id text NOT NULL, status text, scheduled_at text, deleted_at text,
			locale text, published_at text, created_at text,
			PRIMARY KEY (site_id, collection, entry_id, taxonomy_id)
		)`.execute(db);
		await sql`INSERT INTO content_taxonomies_site_new
			(site_id, collection, entry_id, taxonomy_id)
			VALUES ('site-default', 'posts', 'p1', 't1')`.execute(db);
		await up(db);
		await up(db);
		const terms = await sql<{
			id: string;
			site_id: string;
		}>`SELECT id, site_id FROM taxonomies`.execute(db);
		const assignments = await sql<{
			taxonomy_id: string;
			site_id: string;
		}>`SELECT taxonomy_id, site_id FROM content_taxonomies`.execute(db);
		expect(terms.rows).toEqual([{ id: "t1", site_id: "site-default" }]);
		expect(assignments.rows).toHaveLength(1201);
		expect(
			assignments.rows.every((row) => row.taxonomy_id === "t1" && row.site_id === "site-default"),
		).toBe(true);
		await expect(
			sql`INSERT INTO taxonomies (id, name, slug, label) VALUES ('t2', 'category', 'other', 'Other')`.execute(
				db,
			),
		).rejects.toThrow();
		await expect(
			sql`INSERT INTO content_taxonomies (collection, entry_id, taxonomy_id) VALUES ('posts', 'p2', 't1')`.execute(
				db,
			),
		).rejects.toThrow();
		await sql`INSERT INTO taxonomies (id, site_id, name, slug, label, translation_group) VALUES ('t3', 'site-other', 'category', 'news', 'Other News', 't3')`.execute(
			db,
		);
		const both = await sql<{ id: string }>`SELECT id FROM taxonomies WHERE slug = 'news'`.execute(
			db,
		);
		expect(both.rows).toHaveLength(2);
	});
});
