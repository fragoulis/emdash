import { sql, type Kysely } from "kysely";

import { isPostgres, tableExists } from "../dialect-helpers.js";

const DEFAULT_SITE_ID = "site-default";
const TERM_STAGE = "taxonomies_site_new";
const ASSIGNMENT_STAGE = "content_taxonomies_site_new";

async function addAssignmentSite(db: Kysely<unknown>): Promise<void> {
	const columns = (await db.introspection.getTables()).find(
		(table) => table.name === "content_taxonomies",
	)?.columns;
	if (!columns?.some((column) => column.name === "site_id")) {
		await sql`ALTER TABLE content_taxonomies ADD COLUMN site_id TEXT`.execute(db);
	}
	await sql`UPDATE content_taxonomies SET site_id = ${DEFAULT_SITE_ID} WHERE site_id IS NULL`.execute(
		db,
	);
}

async function rebuildAssignments(db: Kysely<unknown>): Promise<void> {
	if (!(await tableExists(db, "content_taxonomies")) && (await tableExists(db, ASSIGNMENT_STAGE))) {
		await db.schema.alterTable(ASSIGNMENT_STAGE).renameTo("content_taxonomies").execute();
	}
	const columns = (await db.introspection.getTables()).find(
		(table) => table.name === "content_taxonomies",
	)?.columns;
	if (columns?.find((column) => column.name === "site_id")?.isNullable) {
		await sql`CREATE TABLE IF NOT EXISTS ${sql.ref(ASSIGNMENT_STAGE)} (
			site_id text NOT NULL, collection text NOT NULL, entry_id text NOT NULL,
			taxonomy_id text NOT NULL, status text, scheduled_at text, deleted_at text,
			locale text, published_at text, created_at text,
			PRIMARY KEY (site_id, collection, entry_id, taxonomy_id)
		)`.execute(db);
		await sql`INSERT OR IGNORE INTO ${sql.ref(ASSIGNMENT_STAGE)}
			(site_id, collection, entry_id, taxonomy_id, status, scheduled_at, deleted_at, locale, published_at, created_at)
			SELECT site_id, collection, entry_id, taxonomy_id, status, scheduled_at, deleted_at, locale, published_at, created_at
			FROM content_taxonomies`.execute(db);
		await db.schema.dropTable("content_taxonomies").execute();
		await db.schema.alterTable(ASSIGNMENT_STAGE).renameTo("content_taxonomies").execute();
	}
	for (const [name, indexColumns] of [
		["idx_content_taxonomies_term", "taxonomy_id"],
		["idx_content_taxonomies_group_lookup", "site_id, taxonomy_id, collection, entry_id"],
		[
			"idx_content_taxonomies_pub",
			"taxonomy_id, collection, deleted_at, published_at DESC, entry_id DESC",
		],
		[
			"idx_content_taxonomies_crt",
			"taxonomy_id, collection, deleted_at, created_at DESC, entry_id DESC",
		],
		[
			"idx_content_taxonomies_loc_pub",
			"taxonomy_id, collection, deleted_at, locale, published_at DESC, entry_id DESC",
		],
		[
			"idx_content_taxonomies_loc_crt",
			"taxonomy_id, collection, deleted_at, locale, created_at DESC, entry_id DESC",
		],
	] as const) {
		await sql`CREATE INDEX IF NOT EXISTS ${sql.ref(name)} ON content_taxonomies (${sql.raw(indexColumns)})`.execute(
			db,
		);
	}
	await sql`CREATE INDEX IF NOT EXISTS idx_content_taxonomies_site_id ON content_taxonomies (site_id)`.execute(
		db,
	);
}

async function rebuildTerms(db: Kysely<unknown>): Promise<void> {
	if (!(await tableExists(db, "taxonomies")) && (await tableExists(db, TERM_STAGE))) {
		await db.schema.alterTable(TERM_STAGE).renameTo("taxonomies").execute();
	}
	const definition = await sql<{
		sql: string;
	}>`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'taxonomies'`.execute(db);
	if (definition.rows[0]?.sql.includes("taxonomies_name_slug_locale_unique")) {
		await sql`CREATE TABLE IF NOT EXISTS ${sql.ref(TERM_STAGE)} (
			id text PRIMARY KEY, name text NOT NULL, slug text NOT NULL, label text NOT NULL,
			parent_id text REFERENCES ${sql.ref(TERM_STAGE)}(id) ON DELETE SET NULL,
			data text, locale text NOT NULL DEFAULT 'en', translation_group text,
			sort_order integer NOT NULL DEFAULT 0, site_id text NOT NULL
		)`.execute(db);
		await sql`INSERT OR IGNORE INTO ${sql.ref(TERM_STAGE)}
			(id, name, slug, label, parent_id, data, locale, translation_group, sort_order, site_id)
			SELECT id, name, slug, label, parent_id, data, locale, translation_group, sort_order, site_id
			FROM taxonomies`.execute(db);
		await db.schema.dropTable("taxonomies").execute();
		await db.schema.alterTable(TERM_STAGE).renameTo("taxonomies").execute();
	}
	for (const [name, column] of [
		["idx_taxonomies_name_locale", "name, locale"],
		["idx_taxonomies_locale", "locale"],
		["idx_taxonomies_translation_group", "translation_group"],
		["idx_taxonomies_parent", "parent_id"],
		["idx_taxonomies_site_id", "site_id"],
	] as const) {
		await sql`CREATE INDEX IF NOT EXISTS ${sql.ref(name)} ON taxonomies (${sql.raw(column)})`.execute(
			db,
		);
	}
}

export async function up(db: Kysely<unknown>): Promise<void> {
	if (isPostgres(db)) {
		await sql`ALTER TABLE taxonomies ALTER COLUMN site_id DROP DEFAULT`.execute(db);
		await sql`ALTER TABLE content_taxonomies ADD COLUMN IF NOT EXISTS site_id TEXT`.execute(db);
		await addAssignmentSite(db);
		await sql`ALTER TABLE content_taxonomies ALTER COLUMN site_id SET NOT NULL`.execute(db);
		await sql`ALTER TABLE taxonomies DROP CONSTRAINT IF EXISTS taxonomies_name_slug_locale_unique`.execute(
			db,
		);
		await sql`ALTER TABLE content_taxonomies DROP CONSTRAINT IF EXISTS content_taxonomies_pk`.execute(
			db,
		);
		const pk = await sql<{ exists: boolean }>`SELECT EXISTS (
			SELECT 1 FROM pg_constraint WHERE conrelid = 'content_taxonomies'::regclass
			AND conname = 'content_taxonomies_site_pk'
		) AS exists`.execute(db);
		if (!pk.rows[0]?.exists) {
			await sql`ALTER TABLE content_taxonomies ADD CONSTRAINT content_taxonomies_site_pk
				PRIMARY KEY (site_id, collection, entry_id, taxonomy_id)`.execute(db);
		}
	} else {
		if (await tableExists(db, "content_taxonomies")) await addAssignmentSite(db);
		await rebuildAssignments(db);
		await rebuildTerms(db);
	}
	await sql`DROP INDEX IF EXISTS idx_content_taxonomies_group_lookup`.execute(db);
	await sql`CREATE INDEX IF NOT EXISTS idx_content_taxonomies_group_lookup
		ON content_taxonomies (site_id, taxonomy_id, collection, entry_id)`.execute(db);
	await sql`DROP INDEX IF EXISTS idx_taxonomies_translation_group_locale_unique`.execute(db);
	await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_taxonomies_site_name_slug_locale_unique
		ON taxonomies (site_id, name, slug, locale)`.execute(db);
	await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_taxonomies_site_group_locale_unique
		ON taxonomies (site_id, translation_group, locale) WHERE translation_group IS NOT NULL`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS idx_taxonomies_site_id ON taxonomies (site_id)`.execute(db);
	await sql`CREATE INDEX IF NOT EXISTS idx_taxonomies_site_name_locale
		ON taxonomies (site_id, name, locale)`.execute(db);
	await sql`CREATE INDEX IF NOT EXISTS idx_taxonomies_site_parent
		ON taxonomies (site_id, parent_id)`.execute(db);
	await sql`CREATE INDEX IF NOT EXISTS idx_content_taxonomies_site_id ON content_taxonomies (site_id)`.execute(
		db,
	);
}

export async function down(_db: Kysely<unknown>): Promise<void> {}
