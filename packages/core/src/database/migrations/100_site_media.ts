import { sql, type Kysely } from "kysely";

import { isPostgres, tableExists } from "../dialect-helpers.js";

const DEFAULT_SITE_ID = "site-default";

export async function up(db: Kysely<unknown>): Promise<void> {
	if (isPostgres(db)) {
		await sql`ALTER TABLE media ALTER COLUMN site_id DROP DEFAULT`.execute(db);
		for (const table of ["media_folders", "_emdash_media_upload_attempts"]) {
			await sql`ALTER TABLE ${sql.ref(table)} ADD COLUMN IF NOT EXISTS site_id text`.execute(db);
			await sql`UPDATE ${sql.ref(table)} SET site_id = ${DEFAULT_SITE_ID} WHERE site_id IS NULL`.execute(
				db,
			);
			await sql`ALTER TABLE ${sql.ref(table)} ALTER COLUMN site_id SET NOT NULL`.execute(db);
		}
		await sql`ALTER TABLE media_folders DROP CONSTRAINT IF EXISTS media_folders_name_key_key`.execute(
			db,
		);
	} else {
		await rebuildSqliteMedia(db);
		await rebuildSqliteFolders(db);
		await rebuildSqliteUploadAttempts(db);
	}
	await sql`CREATE INDEX IF NOT EXISTS idx_media_folders_site_id ON media_folders (site_id)`.execute(
		db,
	);
	await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_media_folders_site_name_key ON media_folders (site_id, name_key)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS idx_media_upload_attempts_site_id ON _emdash_media_upload_attempts (site_id)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS idx_media_site_folder_id ON media (site_id, folder_id)`.execute(
		db,
	);
}

async function rebuildSqliteMedia(db: Kysely<unknown>): Promise<void> {
	const stage = "media_site_new";
	const backup = "media_avatar_site_backup";
	if (!(await tableExists(db, "media")) && (await tableExists(db, stage))) {
		await db.schema.alterTable(stage).renameTo("media").execute();
	}
	const definition = await sql<{
		sql: string;
	}>`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'media'`.execute(db);
	if (definition.rows[0]?.sql.includes("site-default")) {
		await sql`CREATE TABLE IF NOT EXISTS ${sql.ref(backup)} AS
			SELECT id, avatar_media_id FROM _emdash_bylines WHERE avatar_media_id IS NOT NULL`.execute(
			db,
		);
		await sql`CREATE TABLE IF NOT EXISTS ${sql.ref(stage)} (
			id text PRIMARY KEY, filename text NOT NULL, mime_type text NOT NULL,
			size integer, width integer, height integer, alt text, caption text,
			storage_key text NOT NULL, content_hash text,
			created_at text DEFAULT (datetime('now')), author_id text,
			status text NOT NULL DEFAULT 'ready', blurhash text, dominant_color text,
			folder_id text REFERENCES media_folders(id) ON DELETE SET NULL,
			focal_x real, focal_y real, site_id text NOT NULL
		)`.execute(db);
		await sql`INSERT OR IGNORE INTO ${sql.ref(stage)}
			(id, filename, mime_type, size, width, height, alt, caption, storage_key,
			 content_hash, created_at, author_id, status, blurhash, dominant_color,
			 folder_id, focal_x, focal_y, site_id)
			SELECT id, filename, mime_type, size, width, height, alt, caption, storage_key,
			 content_hash, created_at, author_id, status, blurhash, dominant_color,
			 folder_id, focal_x, focal_y, site_id FROM media`.execute(db);
		await db.schema.dropTable("media").execute();
		await db.schema.alterTable(stage).renameTo("media").execute();
	}
	for (const [name, column] of [
		["idx_media_content_hash", "content_hash"],
		["idx_media_status", "status"],
		["idx_media_mime_type", "mime_type"],
		["idx_media_filename", "filename"],
		["idx_media_created_at", "created_at"],
		["idx_media_storage_key", "storage_key"],
		["idx_media_folder_id", "folder_id"],
		["idx_media_site_id", "site_id"],
	] as const) {
		await db.schema.createIndex(name).ifNotExists().on("media").column(column).execute();
	}
	if (await tableExists(db, backup)) {
		await sql`UPDATE _emdash_bylines SET avatar_media_id = (
			SELECT avatar_media_id FROM ${sql.ref(backup)} WHERE id = _emdash_bylines.id
		) WHERE id IN (SELECT id FROM ${sql.ref(backup)})`.execute(db);
		await db.schema.dropTable(backup).execute();
	}
}

async function rebuildSqliteFolders(db: Kysely<unknown>): Promise<void> {
	const table = "media_folders";
	const stage = "media_folders_site_new";
	const backup = "media_folder_assignments_site_backup";
	if (!(await tableExists(db, table)) && (await tableExists(db, stage))) {
		await db.schema.alterTable(stage).renameTo(table).execute();
	}
	const definition = await sql<{
		sql: string;
	}>`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ${table}`.execute(db);
	if (!definition.rows[0]?.sql.includes("site_id text NOT NULL")) {
		await sql`CREATE TABLE IF NOT EXISTS ${sql.ref(backup)} AS
			SELECT id, folder_id FROM media WHERE folder_id IS NOT NULL`.execute(db);
		await sql`CREATE TABLE IF NOT EXISTS ${sql.ref(stage)} (
			id text PRIMARY KEY, name text NOT NULL, name_key text NOT NULL, site_id text NOT NULL
		)`.execute(db);
		const hasSite = definition.rows[0]?.sql.includes("site_id") ?? false;
		await sql`INSERT OR IGNORE INTO ${sql.ref(stage)} (id, name, name_key, site_id)
			SELECT id, name, name_key, ${hasSite ? sql`COALESCE(site_id, ${DEFAULT_SITE_ID})` : sql`${DEFAULT_SITE_ID}`} FROM media_folders`.execute(
			db,
		);
		await db.schema.dropTable(table).execute();
		await db.schema.alterTable(stage).renameTo(table).execute();
	}
	await sql`CREATE INDEX IF NOT EXISTS idx_media_folder_id ON media (folder_id)`.execute(db);
	if (await tableExists(db, backup)) {
		await sql`UPDATE media SET folder_id = (
			SELECT folder_id FROM ${sql.ref(backup)} WHERE id = media.id
		) WHERE id IN (SELECT id FROM ${sql.ref(backup)})`.execute(db);
		await db.schema.dropTable(backup).execute();
	}
}

async function rebuildSqliteUploadAttempts(db: Kysely<unknown>): Promise<void> {
	const table = "_emdash_media_upload_attempts";
	const stage = "media_upload_attempts_site_new";
	if (!(await tableExists(db, table)) && (await tableExists(db, stage))) {
		await db.schema.alterTable(stage).renameTo(table).execute();
	}
	const definition = await sql<{
		sql: string;
	}>`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ${table}`.execute(db);
	if (!definition.rows[0]?.sql.includes("site_id text NOT NULL")) {
		await sql`CREATE TABLE IF NOT EXISTS ${sql.ref(stage)} (
			storage_key text PRIMARY KEY, media_id text NOT NULL, status text NOT NULL,
			created_at text NOT NULL, updated_at text NOT NULL, site_id text NOT NULL
		)`.execute(db);
		const hasSite = definition.rows[0]?.sql.includes("site_id") ?? false;
		await sql`INSERT OR IGNORE INTO ${sql.ref(stage)}
			(storage_key, media_id, status, created_at, updated_at, site_id)
			SELECT storage_key, media_id, status, created_at, updated_at,
			${hasSite ? sql`COALESCE(site_id, ${DEFAULT_SITE_ID})` : sql`${DEFAULT_SITE_ID}`}
			FROM _emdash_media_upload_attempts`.execute(db);
		await db.schema.dropTable(table).execute();
		await db.schema.alterTable(stage).renameTo(table).execute();
	}
	await sql`CREATE INDEX IF NOT EXISTS idx_media_upload_attempts_media_id
		ON _emdash_media_upload_attempts (media_id)`.execute(db);
	await sql`CREATE INDEX IF NOT EXISTS idx_media_upload_attempts_status_created_at
		ON _emdash_media_upload_attempts (status, created_at)`.execute(db);
}

export async function down(_db: Kysely<unknown>): Promise<void> {}
