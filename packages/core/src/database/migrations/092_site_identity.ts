import { type Kysely, sql } from "kysely";

import { isPostgres } from "../dialect-helpers.js";

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable("_emdash_sites")
		.ifNotExists()
		.addColumn("id", "text", (column) => column.primaryKey())
		.addColumn("slug", "text", (column) => column.notNull().unique())
		.addColumn("active", "integer", (column) => column.notNull().defaultTo(1))
		.execute();
	await db.schema
		.createTable("_emdash_site_hosts")
		.ifNotExists()
		.addColumn("hostname", "text", (column) => column.primaryKey())
		.addColumn("site_id", "text", (column) => column.notNull().references("_emdash_sites.id"))
		.execute();
	if (isPostgres(db)) {
		await sql`
			CREATE OR REPLACE FUNCTION emdash_site_id_immutable()
			RETURNS trigger LANGUAGE plpgsql AS $$
			BEGIN
				RAISE EXCEPTION 'Site IDs cannot change';
			END;
			$$
		`.execute(db);
		await sql`DROP TRIGGER IF EXISTS emdash_site_id_immutable ON _emdash_sites`.execute(db);
		await sql`
			CREATE TRIGGER emdash_site_id_immutable BEFORE UPDATE OF id ON _emdash_sites
			FOR EACH ROW WHEN (OLD.id IS DISTINCT FROM NEW.id)
			EXECUTE FUNCTION emdash_site_id_immutable()
		`.execute(db);
	} else {
		await sql`
			CREATE TRIGGER IF NOT EXISTS emdash_site_id_immutable
			BEFORE UPDATE OF id ON _emdash_sites
			WHEN OLD.id IS NOT NEW.id
			BEGIN SELECT RAISE(ABORT, 'Site IDs cannot change'); END
		`.execute(db);
	}
	await db.schema
		.createIndex("idx_emdash_site_hosts_site_id")
		.ifNotExists()
		.on("_emdash_site_hosts")
		.column("site_id")
		.execute();

	for (const table of ["_emdash_collections", "media", "taxonomies", "options"]) {
		const tables = await db.introspection.getTables();
		if (
			!tables
				.find((item) => item.name === table)
				?.columns.some((column) => column.name === "site_id")
		) {
			await db.schema.alterTable(table).addColumn("site_id", "text").execute();
		}
		await db.schema
			.createIndex(`idx_${table.startsWith("_") ? table.slice(1) : table}_site_id`)
			.ifNotExists()
			.on(table)
			.column("site_id")
			.execute();
	}
}

export async function down(_db: Kysely<unknown>): Promise<void> {}
