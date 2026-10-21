import type { Kysely } from "kysely";
import { sql } from "kysely";

import { isPostgres } from "../database/dialect-helpers.js";
import type { Database } from "../database/types.js";
import { validateIdentifier } from "../database/validate.js";
import { resolvePostgresTextSearchConfig } from "./postgres-locale.js";

export type SearchIndexScope = { kind: "site"; siteId: string } | { kind: "installation" };
type FieldDefinition = { slug: string; type: string };
const REBUILD_BATCH_SIZE = 200;
const EXTRACT_KEYS = ["text", "alt", "caption", "code"] as const;
const GENERATED_IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/;

function databaseText(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "bigint") return String(value);
	return "";
}

export class PostgresSearchIndex {
	constructor(private readonly db: Kysely<Database>) {}

	private quote(identifier: string): string {
		if (!GENERATED_IDENTIFIER_PATTERN.test(identifier)) {
			throw new Error("Invalid generated search index identifier");
		}
		return `"${identifier}"`;
	}

	private tableName(collection: string): string {
		validateIdentifier(collection, "collection slug");
		return `_emdash_search_${collection}`;
	}

	async ensureCollectionIndex(
		collection: string,
		searchableFields: string[],
		titleField?: string,
	): Promise<void> {
		if (!isPostgres(this.db) || searchableFields.length === 0) return;
		validateIdentifier(collection, "collection slug");
		for (const field of searchableFields) validateIdentifier(field, "searchable field name");
		const indexName = this.tableName(collection);
		const index = this.quote(indexName);
		const content = this.quote(`ec_${collection}`);
		const fields = await this.getFieldDefinitions(collection);
		const fieldTypes = new Map(fields.map((field) => [field.slug, field.type]));
		await sql
			.raw(`CREATE TABLE IF NOT EXISTS ${index} (
			site_id text NOT NULL, content_id text NOT NULL, locale text NOT NULL,
			search_vector tsvector NOT NULL, title_vector tsvector NOT NULL,
			field_vectors jsonb NOT NULL, PRIMARY KEY (site_id, content_id)
		)`)
			.execute(this.db);
		await sql
			.raw(
				`CREATE INDEX IF NOT EXISTS ${this.quote(`idx_${indexName}_search_vector`)} ON ${index} USING GIN (search_vector)`,
			)
			.execute(this.db);
		await sql
			.raw(
				`CREATE INDEX IF NOT EXISTS ${this.quote(`idx_${indexName}_title_vector`)} ON ${index} USING GIN (title_vector)`,
			)
			.execute(this.db);
		await sql
			.raw(
				`CREATE INDEX IF NOT EXISTS ${this.quote(`idx_${indexName}_site_locale_content`)} ON ${index} (site_id, locale, content_id)`,
			)
			.execute(this.db);

		const fieldExpressions = searchableFields.map((field) => {
			const ref = `NEW.${this.quote(field)}`;
			return fieldTypes.get(field) === "portableText"
				? `_emdash_search_portable_text(to_jsonb(${ref}))`
				: `COALESCE(${ref}::text, '')`;
		});
		const vectorParts = searchableFields.map(
			(field, i) =>
				`setweight(to_tsvector(_emdash_search_config(NEW.locale), ${fieldExpressions[i]}), '${field === titleField ? "A" : "B"}')`,
		);
		const vectorExpr = vectorParts.join(" || ");
		const titleIdx = titleField ? searchableFields.indexOf(titleField) : -1;
		const titleExpr = titleIdx < 0 ? "''" : fieldExpressions[titleIdx];
		const fieldPairs = searchableFields
			.map(
				(field, i) =>
					`'${field}', to_tsvector(_emdash_search_config(NEW.locale), ${fieldExpressions[i]})::text`,
			)
			.join(", ");
		const functionName = this.quote(`${indexName}_sync_fn`);
		const triggerName = this.quote(`${indexName}_sync`);
		await sql
			.raw(`CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			IF TG_OP = 'DELETE' THEN
				DELETE FROM ${index} WHERE site_id = OLD.site_id AND content_id = OLD.id;
				RETURN OLD;
			END IF;
			IF TG_OP = 'UPDATE' THEN
				DELETE FROM ${index} WHERE site_id = OLD.site_id AND content_id = OLD.id;
			END IF;
			IF NEW.deleted_at IS NOT NULL THEN
				DELETE FROM ${index} WHERE site_id = NEW.site_id AND content_id = NEW.id;
				RETURN NEW;
			END IF;
			INSERT INTO ${index} (site_id, content_id, locale, search_vector, title_vector, field_vectors)
			VALUES (NEW.site_id, NEW.id, NEW.locale, ${vectorExpr},
				setweight(to_tsvector(_emdash_search_config(NEW.locale), ${titleExpr}), 'A'),
				jsonb_build_object(${fieldPairs}))
			ON CONFLICT (site_id, content_id) DO UPDATE SET locale = EXCLUDED.locale,
				search_vector = EXCLUDED.search_vector, title_vector = EXCLUDED.title_vector,
				field_vectors = EXCLUDED.field_vectors;
			RETURN NEW;
		END $$`)
			.execute(this.db);
		await sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON ${content}`).execute(this.db);
		await sql
			.raw(
				`CREATE TRIGGER ${triggerName} AFTER INSERT OR UPDATE OR DELETE ON ${content} FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
			)
			.execute(this.db);
	}

	async rebuildCollection(
		collection: string,
		scope: SearchIndexScope,
	): Promise<{ indexed: number }> {
		if (!isPostgres(this.db)) return { indexed: 0 };
		const index = this.quote(this.tableName(collection));
		const contentName = `ec_${collection}`;
		const searchable = await this.getSearchableFields(collection);
		if (!searchable.length) return { indexed: 0 };
		const collectionRow = await this.db
			.selectFrom("_emdash_collections")
			.select("title_field")
			.where("slug", "=", collection)
			.executeTakeFirst();
		const titleField = collectionRow?.title_field ?? undefined;
		const rowBatchSize = Math.max(
			1,
			Math.min(REBUILD_BATCH_SIZE, Math.floor(60_000 / (searchable.length * 2 + 10))),
		);
		const fieldTypes = new Map(
			(await this.getFieldDefinitions(collection)).map((field) => [field.slug, field.type]),
		);
		let lastSite = "";
		let lastId = "";
		let indexed = 0;
		while (true) {
			const rows = await sql<Record<string, unknown>>`SELECT * FROM ${sql.ref(contentName)}
				WHERE deleted_at IS NULL AND (site_id, id) > (${lastSite}, ${lastId})
				${scope.kind === "site" ? sql`AND site_id = ${scope.siteId}` : sql``}
				ORDER BY site_id, id LIMIT ${rowBatchSize}`.execute(this.db);
			if (!rows.rows.length) break;
			const valueRows = [];
			for (const row of rows.rows) {
				const siteId = databaseText(row.site_id);
				const contentId = databaseText(row.id);
				const locale = databaseText(row.locale);
				const config = resolvePostgresTextSearchConfig(locale);
				const values = searchable.map((field) => {
					const value = row[field];
					return fieldTypes.get(field) === "portableText"
						? extractPortableText(value)
						: databaseText(value);
				});
				const rawVectors = values.map((value) => sql`to_tsvector(${config}::regconfig, ${value})`);
				const weightedVectors = rawVectors.map(
					(vector, i) => sql`setweight(${vector}, ${searchable[i] === titleField ? "A" : "B"})`,
				);
				let combined = weightedVectors[0] ?? sql`''::tsvector`;
				for (const vector of weightedVectors.slice(1)) combined = sql`(${combined} || ${vector})`;
				const titleVector = titleField
					? (rawVectors[searchable.indexOf(titleField)] ?? sql`''::tsvector`)
					: sql`''::tsvector`;
				const weightedTitle = sql`setweight(${titleVector}, 'A')`;
				const pairs = searchable.flatMap((field, i) => [
					sql`${field}::text`,
					sql`(${rawVectors[i]})::text`,
				]);
				const fieldVectors = sql`jsonb_build_object(${sql.join(pairs)})`;
				valueRows.push(
					sql`(${siteId}, ${contentId}, ${locale}, ${combined}, ${weightedTitle}, ${fieldVectors})`,
				);
				lastSite = siteId;
				lastId = contentId;
				indexed++;
			}
			await sql`INSERT INTO ${sql.ref(index.replaceAll('"', ""))} (site_id, content_id, locale, search_vector, title_vector, field_vectors)
				VALUES ${sql.join(valueRows, sql`, `)}
				ON CONFLICT (site_id, content_id) DO UPDATE SET locale = EXCLUDED.locale,
				search_vector = EXCLUDED.search_vector, title_vector = EXCLUDED.title_vector, field_vectors = EXCLUDED.field_vectors`.execute(
				this.db,
			);
		}
		while (true) {
			const stale = await sql`DELETE FROM ${sql.ref(index.replaceAll('"', ""))} AS s
				WHERE s.ctid IN (SELECT s2.ctid FROM ${sql.ref(index.replaceAll('"', ""))} AS s2
					WHERE ${scope.kind === "site" ? sql`s2.site_id = ${scope.siteId} AND` : sql``}
					NOT EXISTS (SELECT 1 FROM ${sql.ref(contentName)} AS c WHERE c.site_id = s2.site_id AND c.id = s2.content_id AND c.deleted_at IS NULL)
					LIMIT ${REBUILD_BATCH_SIZE})`.execute(this.db);
			if (Number(stale.numAffectedRows ?? 0n) < REBUILD_BATCH_SIZE) break;
		}
		return { indexed };
	}

	async getCollectionStats(
		collection: string,
		scope: SearchIndexScope,
	): Promise<{ indexed: number } | null> {
		if (!isPostgres(this.db)) return null;
		const name = this.tableName(collection);
		const tables = await this.db.introspection.getTables();
		if (!tables.some((table) => table.name === name)) return null;
		const result = await sql<{
			count: number;
		}>`SELECT count(*)::int AS count FROM ${sql.ref(name)} ${scope.kind === "site" ? sql`WHERE site_id = ${scope.siteId}` : sql``}`.execute(
			this.db,
		);
		return { indexed: result.rows[0]?.count ?? 0 };
	}

	async dropCollectionIndex(collection: string): Promise<void> {
		if (!isPostgres(this.db)) return;
		const index = this.tableName(collection);
		const tables = await this.db.introspection.getTables();
		if (tables.some((table) => table.name === `ec_${collection}`)) {
			await sql
				.raw(
					`DROP TRIGGER IF EXISTS ${this.quote(`${index}_sync`)} ON ${this.quote(`ec_${collection}`)}`,
				)
				.execute(this.db);
		}
		await sql
			.raw(`DROP FUNCTION IF EXISTS ${this.quote(`${index}_sync_fn`)}() CASCADE`)
			.execute(this.db);
		await sql.raw(`DROP TABLE IF EXISTS ${this.quote(index)}`).execute(this.db);
	}

	async initializeEnabledCollections(): Promise<void> {
		const collections = await this.db
			.selectFrom("_emdash_collections")
			.select(["slug", "search_config"])
			.where("search_config", "is not", null)
			.execute();
		for (const { slug, search_config } of collections) {
			let enabled = false;
			try {
				const parsed: unknown = JSON.parse(search_config ?? "null");
				enabled =
					typeof parsed === "object" &&
					parsed !== null &&
					"enabled" in parsed &&
					parsed.enabled === true;
			} catch {
				/* Invalid configs are not indexed. */
			}
			if (!enabled) continue;
			const fields = await this.getSearchableFields(slug);
			const config = await this.db
				.selectFrom("_emdash_collections")
				.select("title_field")
				.where("slug", "=", slug)
				.executeTakeFirst();
			if (fields.length) {
				await this.ensureCollectionIndex(slug, fields, config?.title_field ?? undefined);
				await this.rebuildCollection(slug, { kind: "installation" });
			}
		}
	}

	private async getFieldDefinitions(collection: string): Promise<FieldDefinition[]> {
		const row = await this.db
			.selectFrom("_emdash_collections")
			.select("id")
			.where("slug", "=", collection)
			.executeTakeFirst();
		if (!row) return [];
		return this.db
			.selectFrom("_emdash_fields")
			.select(["slug", "type"])
			.where("collection_id", "=", row.id)
			.execute();
	}

	private async getSearchableFields(collection: string): Promise<string[]> {
		const row = await this.db
			.selectFrom("_emdash_collections")
			.select("id")
			.where("slug", "=", collection)
			.executeTakeFirst();
		if (!row) return [];
		const fields = await this.db
			.selectFrom("_emdash_fields")
			.select("slug")
			.where("collection_id", "=", row.id)
			.where("searchable", "=", 1)
			.execute();
		return fields.map((field) => field.slug);
	}
}

function extractPortableText(value: unknown): string {
	if (typeof value === "string") {
		try {
			return extractPortableText(JSON.parse(value));
		} catch {
			return value;
		}
	}
	if (Array.isArray(value)) return value.map(extractPortableText).filter(Boolean).join(" ");
	if (value && typeof value === "object") {
		return Object.entries(value)
			.map(([key, item]) => {
				if ((EXTRACT_KEYS as readonly string[]).includes(key) && typeof item === "string")
					return item;
				return extractPortableText(item);
			})
			.filter(Boolean)
			.join(" ");
	}
	return "";
}
