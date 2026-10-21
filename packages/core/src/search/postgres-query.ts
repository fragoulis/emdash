import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { Database } from "../database/types.js";
import { validateIdentifier } from "../database/validate.js";
import { resolveConfiguredLocale } from "../i18n/config.js";
import {
	DEFAULT_POSTGRES_TEXT_SEARCH_CONFIG,
	resolvePostgresTextSearchConfig,
	type PostgresTextSearchConfig,
} from "./postgres-locale.js";
import type { SearchResult, Suggestion } from "./types.js";

const START = "\uE000";
const END = "\uE001";
const WHITESPACE_PATTERN = /\s+/;
const SEARCH_CONFIGS: PostgresTextSearchConfig[] = [
	"greek",
	"english",
	"french",
	"german",
	"italian",
	"spanish",
	"portuguese",
	"russian",
	DEFAULT_POSTGRES_TEXT_SEARCH_CONFIG,
];

function escapeHtml(value: string): string {
	return value.replace(
		/[&<>"']/g,
		(char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
	);
}

function terms(query: string): string[] {
	return query.trim().split(WHITESPACE_PATTERN).filter(Boolean).slice(0, 32);
}

function validTitle(fields: string[], configured?: string): string | undefined {
	const field =
		configured && fields.includes(configured)
			? configured
			: fields.includes("title")
				? "title"
				: undefined;
	if (field) validateIdentifier(field, "title field");
	return field;
}

function rowConfig() {
	return sql`_emdash_search_config(c.locale)`;
}

function indexedMatch(
	query: (config: PostgresTextSearchConfig) => ReturnType<typeof sql>,
	locale?: string,
) {
	if (locale) {
		const config = resolvePostgresTextSearchConfig(locale);
		return sql`i.search_vector @@ ${query(config)}`;
	}
	return sql`(${sql.join(
		SEARCH_CONFIGS.map(
			(config) =>
				sql`(_emdash_search_config(c.locale)::text = ${config} AND i.search_vector @@ ${query(config)})`,
		),
		sql` OR `,
	)})`;
}

export async function searchPostgresCollection(
	db: Kysely<Database>,
	collection: string,
	query: string,
	options: {
		siteId: string;
		status: string;
		locale?: string;
		limit: number;
		scope?: "all" | "title";
	},
	fields: string[],
	weights: Record<string, number> = {},
	configuredTitle?: string,
): Promise<SearchResult[]> {
	validateIdentifier(collection, "collection slug");
	const words = terms(query);
	if (!words.length || fields.length === 0) return [];
	const title = validTitle(fields, configuredTitle);
	if (options.scope === "title" && !title) return [];
	const phrase = words.join(" ");
	const config = rowConfig();
	const queryExpr = sql`plainto_tsquery(${config}, ${phrase})`;
	const match = indexedMatch(
		(textConfig) => sql`plainto_tsquery(${textConfig}::text::regconfig, ${phrase})`,
		options.locale ? resolveConfiguredLocale(options.locale) : undefined,
	);
	const scopedMatch =
		options.scope === "title" && title
			? options.locale
				? sql`AND (i.field_vectors ->> ${title})::tsvector @@ plainto_tsquery(${resolvePostgresTextSearchConfig(resolveConfiguredLocale(options.locale))}::text::regconfig, ${phrase})`
				: sql`AND (${sql.join(
						SEARCH_CONFIGS.map(
							(textConfig) =>
								sql`(_emdash_search_config(c.locale)::text = ${textConfig} AND (i.field_vectors ->> ${title})::tsvector @@ plainto_tsquery(${textConfig}::text::regconfig, ${phrase}))`,
						),
						sql` OR `,
					)})`
			: sql``;
	const rankedFields = options.scope === "title" && title ? [title] : fields;
	const scoreParts = rankedFields.map((field) => {
		validateIdentifier(field, "searchable field name");
		return sql`ts_rank_cd((i.field_vectors ->> ${field})::tsvector, ${queryExpr}) * ${weights[field] ?? 1}`;
	});
	const score = scoreParts.length ? sql.join(scoreParts, sql` + `) : sql`0::real`;
	const sourceParts = fields.map((field) => {
		validateIdentifier(field, "searchable field name");
		return sql`CASE WHEN field_meta.types ->> ${field} = 'portableText' THEN
			COALESCE(_emdash_search_portable_text(to_jsonb(c.${sql.ref(field)})), '')
			ELSE coalesce(c.${sql.ref(field)}::text, '') END`;
	});
	const source = sourceParts.length ? sql.join(sourceParts, sql` || ' ' || `) : sql`''`;
	const cleanSource = sql`replace(replace(regexp_replace(${source}, '</?[A-Za-z][A-Za-z0-9:-]*(?:\\s+[^<>]*?)?\\s*/?>', ' ', 'g'), ${START}, ''), ${END}, '')`;
	const headline = sql`ts_headline(${config}, ${cleanSource}, ${queryExpr}, ${`StartSel=${START}, StopSel=${END}, MaxFragments=1, MaxWords=32, MinWords=8`})`;
	const results = await sql<{
		id: string;
		slug: string | null;
		locale: string;
		title: string | null;
		snippet: string | null;
		score: number;
	}>`
		SELECT c.id, c.slug, c.locale, ${title ? sql`c.${sql.ref(title)}` : sql`NULL`} AS title,
			${headline} AS snippet, (${score})::float8 AS score
		FROM ${sql.ref(`_emdash_search_${collection}`)} i
		JOIN ${sql.ref(`ec_${collection}`)} c ON c.id = i.content_id AND c.site_id = i.site_id
		CROSS JOIN (
			SELECT jsonb_object_agg(f.slug, f.type) AS types
			FROM _emdash_fields f JOIN _emdash_collections co ON co.id = f.collection_id
			WHERE co.slug = ${collection} AND f.slug IN (${sql.join(fields.map((field) => sql`${field}`))})
		) field_meta
		WHERE i.site_id = ${options.siteId} AND i.locale = c.locale
			AND ${match}
			${scopedMatch}
			AND c.status = ${options.status} AND c.deleted_at IS NULL
			${options.locale ? sql`AND c.locale = ${resolveConfiguredLocale(options.locale)}` : sql``}
		ORDER BY score DESC, c.id ASC LIMIT ${options.limit}
	`.execute(db);
	return results.rows.map((row) => {
		let snippet: string | undefined;
		if (row.snippet) {
			const escaped = escapeHtml(row.snippet);
			snippet = escaped.replaceAll(START, "<mark>").replaceAll(END, "</mark>");
		}
		return {
			collection,
			id: row.id,
			slug: row.slug,
			locale: row.locale,
			title: row.title ?? undefined,
			snippet,
			score: row.score,
		};
	});
}

export async function suggestPostgresCollection(
	db: Kysely<Database>,
	collection: string,
	query: string,
	options: { siteId: string; locale?: string; limit: number },
	fields: string[],
	configuredTitle?: string,
): Promise<Suggestion[]> {
	validateIdentifier(collection, "collection slug");
	const title = validTitle(fields, configuredTitle);
	if (!title) return [];
	const cleanTerms =
		query
			.normalize("NFC")
			.match(/[\p{L}\p{M}\p{N}_]+/gu)
			?.slice(0, 32) ?? [];
	if (!cleanTerms.length) return [];
	const prefix = cleanTerms.map((term) => `${term}:*`).join(" & ");
	const config = rowConfig();
	const tsquery = sql`to_tsquery(${config}, ${prefix})`;
	const result = await sql<{ id: string; slug: string | null; title: string }>`
		SELECT c.id, c.slug, c.${sql.ref(title)} AS title
		FROM ${sql.ref(`_emdash_search_${collection}`)} i
		JOIN ${sql.ref(`ec_${collection}`)} c ON c.id = i.content_id AND c.site_id = i.site_id
		WHERE i.site_id = ${options.siteId} AND i.locale = c.locale
			AND ${indexedMatch(
				(textConfig) => sql`to_tsquery(${textConfig}::text::regconfig, ${prefix})`,
				options.locale ? resolveConfiguredLocale(options.locale) : undefined,
			)}
			AND (${sql.join(
				SEARCH_CONFIGS.map(
					(textConfig) =>
						sql`(_emdash_search_config(c.locale)::text = ${textConfig} AND (i.field_vectors ->> ${title})::tsvector @@ to_tsquery(${textConfig}::text::regconfig, ${prefix}))`,
				),
				sql` OR `,
			)})
			AND c.status = 'published' AND c.deleted_at IS NULL AND c.${sql.ref(title)} IS NOT NULL
			${options.locale ? sql`AND c.locale = ${resolveConfiguredLocale(options.locale)}` : sql``}
		ORDER BY ts_rank_cd((i.field_vectors ->> ${title})::tsvector, ${tsquery}) DESC, c.id ASC LIMIT ${options.limit}
	`.execute(db);
	return result.rows.map((row) => ({ collection, id: row.id, slug: row.slug, title: row.title }));
}
