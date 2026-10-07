import { type Kysely, sql } from "kysely";

import { isPostgres, listTablesLike } from "../dialect-helpers.js";
import { validateIdentifier } from "../validate.js";

export async function up(db: Kysely<unknown>): Promise<void> {
	for (const table of await listTablesLike(db, "ec_%")) {
		validateIdentifier(table);
		if (!table.startsWith("ec_")) continue;
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
		if (isPostgres(db)) {
			await sql`ALTER TABLE ${sql.ref(table)} DROP CONSTRAINT IF EXISTS ${sql.ref(`${table}_slug_locale_unique`)}`.execute(
				db,
			);
			await sql`CREATE UNIQUE INDEX IF NOT EXISTS ${sql.ref(`${table}_site_slug_locale_unique`)} ON ${sql.ref(table)} (site_id, slug, locale)`.execute(
				db,
			);
		}
		await db.schema
			.createIndex(`idx_${table}_site_id`)
			.ifNotExists()
			.on(table)
			.column("site_id")
			.execute();
	}
}

export async function down(_db: Kysely<unknown>): Promise<void> {}
