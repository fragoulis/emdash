export const DEFAULT_POSTGRES_TEXT_SEARCH_CONFIG = "simple" as const;

export type PostgresTextSearchConfig =
	| "greek"
	| "english"
	| "french"
	| "german"
	| "italian"
	| "spanish"
	| "portuguese"
	| "russian"
	| typeof DEFAULT_POSTGRES_TEXT_SEARCH_CONFIG;

const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;

const CONFIG_BY_LANGUAGE: Readonly<Record<string, PostgresTextSearchConfig>> = {
	el: "greek",
	en: "english",
	fr: "french",
	de: "german",
	it: "italian",
	es: "spanish",
	pt: "portuguese",
	ru: "russian",
};

export function resolvePostgresTextSearchConfig(
	locale: string | null | undefined,
): PostgresTextSearchConfig {
	if (!locale) return DEFAULT_POSTGRES_TEXT_SEARCH_CONFIG;
	const normalized = locale.trim().replaceAll("_", "-").toLowerCase();
	if (!LOCALE_PATTERN.test(normalized)) {
		return DEFAULT_POSTGRES_TEXT_SEARCH_CONFIG;
	}
	return CONFIG_BY_LANGUAGE[normalized.split("-")[0] ?? ""] ?? DEFAULT_POSTGRES_TEXT_SEARCH_CONFIG;
}
