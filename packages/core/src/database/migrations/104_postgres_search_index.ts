import type { Kysely } from "kysely";
import { sql } from "kysely";

import { PostgresSearchIndex } from "../../search/postgres-index.js";
import { isPostgres } from "../dialect-helpers.js";
import type { Database } from "../types.js";

export async function up(db: Kysely<unknown>): Promise<void> {
	if (!isPostgres(db)) return;
	await sql`CREATE OR REPLACE FUNCTION _emdash_search_config(locale text) RETURNS regconfig
		LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
			SELECT CASE lower(split_part(replace(coalesce(locale, ''), '_', '-'), '-', 1))
				WHEN 'el' THEN 'greek'::regconfig
				WHEN 'en' THEN 'english'::regconfig
				WHEN 'fr' THEN 'french'::regconfig
				WHEN 'de' THEN 'german'::regconfig
				WHEN 'it' THEN 'italian'::regconfig
				WHEN 'es' THEN 'spanish'::regconfig
				WHEN 'pt' THEN 'portuguese'::regconfig
				WHEN 'ru' THEN 'russian'::regconfig
				ELSE 'simple'::regconfig END
		$$`.execute(db);
	await sql`CREATE OR REPLACE FUNCTION _emdash_search_portable_text(value jsonb) RETURNS text
		LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
		DECLARE result text := ''; item record;
		BEGIN
			IF value IS NULL THEN RETURN ''; END IF;
			IF jsonb_typeof(value) = 'object' THEN
				FOR item IN SELECT key, val FROM jsonb_each(value) AS e(key, val) LOOP
					IF item.key IN ('text', 'alt', 'caption', 'code') AND jsonb_typeof(item.val) = 'string' THEN
						result := concat_ws(' ', result, item.val #>> '{}');
					ELSIF jsonb_typeof(item.val) IN ('object', 'array') THEN
						result := concat_ws(' ', result, _emdash_search_portable_text(item.val));
					END IF;
				END LOOP;
			ELSIF jsonb_typeof(value) = 'array' THEN
				FOR item IN SELECT val FROM jsonb_array_elements(value) AS e(val) LOOP
					result := concat_ws(' ', result, _emdash_search_portable_text(item.val));
				END LOOP;
			END IF;
			RETURN result;
		END $$`.execute(db);
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- migration runner supplies the application's database schema
	await new PostgresSearchIndex(db as Kysely<Database>).initializeEnabledCollections();
}

export async function down(db: Kysely<unknown>): Promise<void> {
	if (!isPostgres(db)) return;
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- migration runner supplies the application's database schema
	const typedDb = db as Kysely<Database>;
	const collections = await typedDb.selectFrom("_emdash_collections").select("slug").execute();
	const index = new PostgresSearchIndex(typedDb);
	for (const { slug } of collections) {
		await index.dropCollectionIndex(slug);
	}
	await sql`DROP FUNCTION IF EXISTS _emdash_search_portable_text(jsonb)`.execute(db);
	await sql`DROP FUNCTION IF EXISTS _emdash_search_config(text)`.execute(db);
}
