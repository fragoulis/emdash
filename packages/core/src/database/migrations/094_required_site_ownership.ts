import { type Kysely, sql } from "kysely";

import { isPostgres } from "../dialect-helpers.js";
const DEFAULT_SITE_ID = "site-default";
const SITE_OWNED_TABLES = ["_emdash_collections", "media", "taxonomies", "options"] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
	for (const table of SITE_OWNED_TABLES) {
		if (isPostgres(db)) {
			await sql`UPDATE ${sql.ref(table)} SET site_id = ${DEFAULT_SITE_ID} WHERE site_id IS NULL`.execute(
				db,
			);
			await sql`ALTER TABLE ${sql.ref(table)} ALTER COLUMN site_id SET NOT NULL`.execute(db);
			continue;
		}

		const index = `idx_${table.startsWith("_") ? table.slice(1) : table}_site_id`;
		const columns = (await db.introspection.getTables()).find(
			(item) => item.name === table,
		)?.columns;
		if (!columns) throw new Error(`Missing site-owned table: ${table}`);
		const oldColumn = columns.find((item) => item.name === "site_id_nullable");
		const siteColumn = columns.find((item) => item.name === "site_id");
		if (siteColumn?.isNullable || oldColumn) {
			await db.schema.dropIndex(index).ifExists().execute();
			if (!oldColumn && siteColumn) {
				await db.schema.alterTable(table).renameColumn("site_id", "site_id_nullable").execute();
			}
			if (!oldColumn || !siteColumn) {
				await db.schema
					.alterTable(table)
					.addColumn("site_id", "text", (column) => column.notNull().defaultTo(DEFAULT_SITE_ID))
					.execute();
			}
			await sql`UPDATE ${sql.ref(table)} SET site_id = COALESCE(site_id_nullable, site_id)`.execute(
				db,
			);
			await db.schema.alterTable(table).dropColumn("site_id_nullable").execute();
		}
		await db.schema.createIndex(index).ifNotExists().on(table).column("site_id").execute();
	}
}

export async function down(_db: Kysely<unknown>): Promise<void> {}
