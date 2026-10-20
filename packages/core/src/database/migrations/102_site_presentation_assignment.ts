import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	const columns = (await db.introspection.getTables()).find(
		(table) => table.name === "_emdash_sites",
	)?.columns;
	if (!columns) throw new Error("Missing _emdash_sites table");
	if (!columns.some((column) => column.name === "presentation")) {
		await db.schema.alterTable("_emdash_sites").addColumn("presentation", "text").execute();
	}
	await sql`UPDATE _emdash_sites SET presentation = CASE WHEN id = 'site-default' THEN 'default' ELSE slug END WHERE presentation IS NULL`.execute(
		db,
	);
}

export async function down(_db: Kysely<unknown>): Promise<void> {}
