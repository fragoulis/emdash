import { type Kysely, sql } from "kysely";

import { isPostgres } from "../dialect-helpers.js";

export async function up(db: Kysely<unknown>): Promise<void> {
	if (isPostgres(db)) {
		await sql`ALTER TABLE _emdash_collections ALTER COLUMN site_id DROP NOT NULL`.execute(db);
		await sql`ALTER TABLE _emdash_collections ALTER COLUMN site_id DROP DEFAULT`.execute(db);
		return;
	}

	const columns = (await db.introspection.getTables()).find(
		(table) => table.name === "_emdash_collections",
	)?.columns;
	if (!columns) throw new Error("Missing _emdash_collections table");

	const oldColumn = columns.find((column) => column.name === "site_id_101_old");
	const siteColumn = columns.find((column) => column.name === "site_id");
	const renameRequired = !oldColumn && siteColumn !== undefined && !siteColumn.isNullable;
	await db.schema.dropIndex("idx_emdash_collections_site_id").ifExists().execute();
	if (renameRequired) {
		await db.schema
			.alterTable("_emdash_collections")
			.renameColumn("site_id", "site_id_101_old")
			.execute();
	}
	const legacyColumnPresent = oldColumn !== undefined || renameRequired;
	if (!siteColumn || renameRequired) {
		await db.schema.alterTable("_emdash_collections").addColumn("site_id", "text").execute();
	}
	if (legacyColumnPresent) {
		await sql`UPDATE _emdash_collections SET site_id = COALESCE(site_id_101_old, site_id)`.execute(
			db,
		);
		await db.schema.alterTable("_emdash_collections").dropColumn("site_id_101_old").execute();
	}
	await db.schema
		.createIndex("idx_emdash_collections_site_id")
		.ifNotExists()
		.on("_emdash_collections")
		.column("site_id")
		.execute();
}

export async function down(_db: Kysely<unknown>): Promise<void> {}
