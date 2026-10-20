import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable("_emdash_site_creation_requests")
		.ifNotExists()
		.addColumn("actor_scope", "text", (column) => column.notNull())
		.addColumn("actor_id", "text")
		.addColumn("request_key", "text", (column) => column.notNull())
		.addColumn("payload_hash", "text", (column) => column.notNull())
		.addColumn("site_id", "text", (column) =>
			column.notNull().unique().references("_emdash_sites.id"),
		)
		.addColumn("created_at", "text", (column) => column.notNull())
		.addPrimaryKeyConstraint("_emdash_site_creation_requests_pk", ["actor_scope", "request_key"])
		.execute();
}

export async function down(_db: Kysely<unknown>): Promise<void> {}
