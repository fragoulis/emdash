import { sql, type Kysely, type RawBuilder } from "kysely";

import { getI18nConfig } from "../../i18n/config.js";
import { currentTimestamp, isPostgres, listTablesLike, tableExists } from "../dialect-helpers.js";
import { validateIdentifier } from "../validate.js";

const BACKFILL_BATCH_SIZE = 50;

async function backfillSatellite(
	db: Kysely<unknown>,
	contentTable: string,
	collection: string,
	satelliteTable: "revisions" | "_emdash_content_bylines",
	collectionColumn: "collection" | "collection_slug",
	entryColumn: "entry_id" | "content_id",
): Promise<void> {
	let lastId: string | null = null;
	while (true) {
		const cursor: RawBuilder<unknown> = lastId === null ? sql`` : sql`AND satellite.id > ${lastId}`;
		const { rows } = await sql<{ id: string }>`
			SELECT satellite.id
			FROM ${sql.ref(satelliteTable)} AS satellite
			JOIN ${sql.ref(contentTable)} AS content
				ON content.id = satellite.${sql.ref(entryColumn)}
			WHERE satellite.${sql.ref(collectionColumn)} = ${collection}
			AND satellite.site_id != content.site_id
			${cursor}
			ORDER BY satellite.id
			LIMIT ${BACKFILL_BATCH_SIZE}
		`.execute(db);
		if (rows.length === 0) break;
		await sql`
			UPDATE ${sql.ref(satelliteTable)}
			SET site_id = (
				SELECT content.site_id FROM ${sql.ref(contentTable)} AS content
				WHERE content.id = ${sql.ref(satelliteTable)}.${sql.ref(entryColumn)}
			)
			WHERE id IN (${sql.join(rows.map((row) => row.id))})
		`.execute(db);
		lastId = rows.at(-1)!.id;
		if (rows.length < BACKFILL_BATCH_SIZE) break;
	}
}

async function scopeBylineUniques(db: Kysely<unknown>): Promise<void> {
	if (isPostgres(db)) {
		await sql`ALTER TABLE _emdash_bylines
			DROP CONSTRAINT IF EXISTS _emdash_bylines_slug_locale_unique`.execute(db);
	} else {
		const staged = "_emdash_bylines_site_new";
		const backup = "_emdash_byline_field_values_site_backup";
		const definition = await sql<{ sql: string }>`SELECT sql FROM sqlite_master
			WHERE type = 'table' AND name = '_emdash_bylines'`.execute(db);
		if (definition.rows[0]?.sql.includes("_emdash_bylines_slug_locale_unique")) {
			// Dropping the parent cascades to field values on D1, even with deferred FKs.
			await sql`CREATE TABLE IF NOT EXISTS ${sql.ref(backup)} AS
				SELECT * FROM _emdash_byline_field_values`.execute(db);
			await db.schema.dropTable(staged).ifExists().execute();
			await db.schema
				.createTable(staged)
				.addColumn("id", "text", (c) => c.primaryKey())
				.addColumn("slug", "text", (c) => c.notNull())
				.addColumn("display_name", "text", (c) => c.notNull())
				.addColumn("bio", "text")
				.addColumn("avatar_media_id", "text", (c) => c.references("media.id").onDelete("set null"))
				.addColumn("website_url", "text")
				.addColumn("user_id", "text", (c) => c.references("users.id").onDelete("set null"))
				.addColumn("is_guest", "integer", (c) => c.notNull().defaultTo(0))
				.addColumn("created_at", "text", (c) => c.defaultTo(currentTimestamp(db)))
				.addColumn("updated_at", "text", (c) => c.defaultTo(currentTimestamp(db)))
				.addColumn("locale", "text", (c) =>
					c.notNull().defaultTo(getI18nConfig()?.defaultLocale ?? "en"),
				)
				.addColumn("translation_group", "text")
				.addColumn("site_id", "text", (c) => c.notNull().defaultTo("site-default"))
				.execute();
			await sql`INSERT INTO ${sql.ref(staged)}
				(id, slug, display_name, bio, avatar_media_id, website_url, user_id,
				 is_guest, created_at, updated_at, locale, translation_group, site_id)
				SELECT id, slug, display_name, bio, avatar_media_id, website_url, user_id,
				 is_guest, created_at, updated_at, locale, translation_group, site_id
				FROM _emdash_bylines`.execute(db);
			await db.schema.dropTable("_emdash_bylines").execute();
			await db.schema.alterTable(staged).renameTo("_emdash_bylines").execute();
		}
		for (const [name, column] of [
			["idx_bylines_slug", "slug"],
			["idx_bylines_display_name", "display_name"],
			["idx__emdash_bylines_locale", "locale"],
			["idx__emdash_bylines_translation_group", "translation_group"],
		] as const) {
			await db.schema
				.createIndex(name)
				.ifNotExists()
				.on("_emdash_bylines")
				.column(column)
				.execute();
		}
		await db.schema
			.createIndex("idx_emdash_bylines_site_id")
			.ifNotExists()
			.on("_emdash_bylines")
			.column("site_id")
			.execute();
		if (await tableExists(db, backup)) {
			await sql`INSERT OR IGNORE INTO _emdash_byline_field_values
				SELECT * FROM ${sql.ref(backup)}`.execute(db);
			await db.schema.dropTable(backup).execute();
		}
	}

	await sql`DROP INDEX IF EXISTS idx_bylines_user_id_locale_unique`.execute(db);
	await sql`DROP INDEX IF EXISTS idx_bylines_group_locale_unique`.execute(db);
	await sql`CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref("idx_bylines_site_slug_locale_unique")}
		ON _emdash_bylines (site_id, slug, locale)`.execute(db);
	await sql`CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref("idx_bylines_site_user_locale_unique")}
		ON _emdash_bylines (site_id, user_id, locale) WHERE user_id IS NOT NULL`.execute(db);
	await sql`CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref("idx_bylines_site_group_locale_unique")}
		ON _emdash_bylines (site_id, translation_group, locale)
		WHERE translation_group IS NOT NULL`.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
	if (
		!isPostgres(db) &&
		!(await tableExists(db, "_emdash_bylines")) &&
		(await tableExists(db, "_emdash_bylines_site_new"))
	) {
		await db.schema.alterTable("_emdash_bylines_site_new").renameTo("_emdash_bylines").execute();
	}
	for (const table of ["_emdash_bylines", "_emdash_content_bylines", "revisions"]) {
		const columns = (await db.introspection.getTables()).find(
			(item) => item.name === table,
		)?.columns;
		if (!columns?.some((column) => column.name === "site_id")) {
			await db.schema
				.alterTable(table)
				.addColumn("site_id", "text", (column) => {
					const required = column.notNull().defaultTo("site-default");
					return isPostgres(db) ? required.references("_emdash_sites.id") : required;
				})
				.execute();
		}
		const index = db.schema
			.createIndex(`idx_${table.startsWith("_") ? table.slice(1) : table}_site_id`)
			.ifNotExists()
			.on(table);
		await (
			table === "_emdash_content_bylines"
				? index.columns(["site_id", "collection_slug", "content_id"])
				: index.column("site_id")
		).execute();
	}

	await scopeBylineUniques(db);

	for (const table of await listTablesLike(db, "ec_%")) {
		validateIdentifier(table);
		if (!table.startsWith("ec_")) continue;
		const collection = table.slice(3);
		await backfillSatellite(db, table, collection, "revisions", "collection", "entry_id");
		await backfillSatellite(
			db,
			table,
			collection,
			"_emdash_content_bylines",
			"collection_slug",
			"content_id",
		);
	}
}

export async function down(_db: Kysely<unknown>): Promise<void> {}
