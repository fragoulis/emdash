import { type Kysely, sql } from "kysely";

import { isPostgres } from "../dialect-helpers.js";

export const DEFAULT_SITE_ID = "site-default";
export const SITE_OWNED_TABLES = ["_emdash_collections", "media", "taxonomies", "options"] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		INSERT INTO _emdash_sites (id, slug, active)
		VALUES (${DEFAULT_SITE_ID}, 'default', 1)
		ON CONFLICT (id) DO NOTHING
	`.execute(db);
	const site = await sql<{
		slug: string;
	}>`SELECT slug FROM _emdash_sites WHERE id = ${DEFAULT_SITE_ID}`.execute(db);
	if (site.rows[0]?.slug !== "default") throw new Error("Default site ID belongs to another site");

	for (const table of SITE_OWNED_TABLES) {
		if (isPostgres(db)) {
			await sql`ALTER TABLE ${sql.ref(table)} ALTER COLUMN site_id SET DEFAULT ${sql.lit(DEFAULT_SITE_ID)}`.execute(
				db,
			);
		}
		await sql`UPDATE ${sql.ref(table)} SET site_id = ${DEFAULT_SITE_ID} WHERE site_id IS NULL`.execute(
			db,
		);
	}
}

export async function down(_db: Kysely<unknown>): Promise<void> {}
