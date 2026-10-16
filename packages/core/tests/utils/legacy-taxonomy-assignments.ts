import { sql, type Kysely } from "kysely";

import type { Database } from "../../src/database/types.js";

export async function restoreLegacyTaxonomyAssignments(db: Kysely<Database>): Promise<void> {
	await sql`CREATE TABLE content_taxonomies_legacy (
		collection text NOT NULL, entry_id text NOT NULL, taxonomy_id text NOT NULL,
		status text, scheduled_at text, deleted_at text, locale text, published_at text, created_at text,
		CONSTRAINT content_taxonomies_pk PRIMARY KEY (collection, entry_id, taxonomy_id)
	)`.execute(db);
	await sql`INSERT INTO content_taxonomies_legacy
		(collection, entry_id, taxonomy_id, status, scheduled_at, deleted_at, locale, published_at, created_at)
		SELECT collection, entry_id, taxonomy_id, status, scheduled_at, deleted_at, locale, published_at, created_at
		FROM content_taxonomies`.execute(db);
	await db.schema.dropTable("content_taxonomies").execute();
	await db.schema.alterTable("content_taxonomies_legacy").renameTo("content_taxonomies").execute();
}
