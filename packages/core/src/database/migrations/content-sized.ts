import { sql, type Kysely, type RawBuilder } from "kysely";

import { isMissingColumnError, isMissingTableError } from "../../utils/db-errors.js";
import { isPostgres } from "../dialect-helpers.js";
import type { Database } from "../types.js";
import { validateIdentifier } from "../validate.js";

/**
 * A migration whose work grows with the site's content. A caller that cannot
 * finish a long run, such as auto mode inside a Worker request, compares the
 * row count with its limit before it takes the migration lock.
 */
export interface ContentSizedMigration {
	/**
	 * Counts the rows the migration writes, with rows it only reads weighted by
	 * their share of a statement. Stops once `cap` is reached.
	 */
	countRows(db: Kysely<Database>, cap: number): Promise<number>;
}

async function countCapped(
	db: Kysely<Database>,
	rows: RawBuilder<unknown>,
	cap: number,
): Promise<number> {
	try {
		const result = await sql<{ count: number | string | bigint }>`
			SELECT COUNT(*) AS count FROM (${rows} LIMIT ${cap}) AS capped
		`.execute(db);
		return Number(result.rows[0]?.count ?? 0);
	} catch (error) {
		if (isMissingTableError(error)) return 0;
		throw error;
	}
}

const DATETIME_COLLECTIONS = sql`
	SELECT collection.slug FROM _emdash_collections AS collection
	INNER JOIN _emdash_fields AS field ON field.collection_id = collection.id
	WHERE field.type IN ('datetime', 'repeater')
`;

/**
 * 079 can update every content entry, and every revision of a collection with
 * datetime or repeater fields, one statement each. It only reads the other
 * revisions, 50 per statement in each of its three passes, so about 16 of them
 * cost what one written row does.
 */
const READ_ONLY_REVISIONS_PER_ROW = 16;

async function countPostgresSearchIndexRows(db: Kysely<Database>, cap: number): Promise<number> {
	if (!isPostgres(db)) return 0;
	let collections: { slug: string; search_config: string | null }[];
	try {
		collections = await db
			.selectFrom("_emdash_collections")
			.select(["slug", "search_config"])
			.execute();
	} catch (error) {
		if (isMissingTableError(error) || isMissingColumnError(error, "search_config")) return 0;
		throw error;
	}
	let rows = 0;
	for (const collection of collections) {
		let enabled = false;
		try {
			const parsed: unknown = JSON.parse(collection.search_config ?? "null");
			enabled =
				typeof parsed === "object" &&
				parsed !== null &&
				"enabled" in parsed &&
				parsed.enabled === true;
		} catch {
			continue;
		}
		if (!enabled || rows >= cap) continue;
		validateIdentifier(collection.slug, "collection slug");
		rows += await countCapped(
			db,
			sql`SELECT 1 FROM ${sql.ref(`ec_${collection.slug}`)}`,
			cap - rows,
		);
	}
	return rows;
}

async function countDatetimeNormalizationRows(db: Kysely<Database>, cap: number): Promise<number> {
	let slugs: string[];
	try {
		const collections = await db.selectFrom("_emdash_collections").select("slug").execute();
		slugs = collections.map((collection) => collection.slug);
	} catch (error) {
		if (isMissingTableError(error)) return 0;
		throw error;
	}
	let rows = await countCapped(
		db,
		sql`SELECT 1 FROM revisions WHERE collection IN (${DATETIME_COLLECTIONS})`,
		cap,
	);
	for (const slug of slugs) {
		if (rows >= cap) return rows;
		validateIdentifier(slug, "collection slug");
		// oxlint-disable-next-line no-await-in-loop -- each count is capped by what the previous ones left
		rows += await countCapped(db, sql`SELECT 1 FROM ${sql.ref(`ec_${slug}`)}`, cap - rows);
	}
	if (rows >= cap) return rows;
	const readOnly = await countCapped(
		db,
		sql`SELECT 1 FROM revisions WHERE collection NOT IN (${DATETIME_COLLECTIONS})`,
		(cap - rows) * READ_ONLY_REVISIONS_PER_ROW,
	);
	return rows + Math.ceil(readOnly / READ_ONLY_REVISIONS_PER_ROW);
}

/** Keyed by migration name, since a published migration's module must not change. */
export const CONTENT_SIZED_MIGRATIONS: ReadonlyMap<string, ContentSizedMigration> = new Map([
	["079_datetime_normalization", { countRows: countDatetimeNormalizationRows }],
	["104_postgres_search_index", { countRows: countPostgresSearchIndexRows }],
]);
