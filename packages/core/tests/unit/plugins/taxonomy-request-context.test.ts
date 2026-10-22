import { sql } from "kysely";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { TaxonomyRepository } from "../../../src/database/repositories/taxonomy.js";
import type { Database } from "../../../src/database/types.js";
import {
	createTaxonomyAccess,
	createTaxonomyAccessWithWrite,
} from "../../../src/plugins/context.js";
import { runWithContext } from "../../../src/request-context.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

describe("plugin taxonomy request context", () => {
	let db: Kysely<Database> | undefined;

	afterEach(async () => {
		if (db) await teardownTestDatabase(db);
		db = undefined;
	});

	it("constructs without a site and reads each selected site's terms", async () => {
		db = await setupTestDatabase();
		await sql`INSERT INTO _emdash_sites (id, slug) VALUES ('foo', 'foo'), ('bar', 'bar')`.execute(
			db,
		);
		await sql`
			INSERT INTO _emdash_taxonomy_defs
				(id, name, label, label_singular, hierarchical, collections, locale, translation_group)
			VALUES ('genre', 'genre', 'Genres', 'Genre', 0, '[]', 'en', 'genre')
		`.execute(db);

		const read = createTaxonomyAccess(db);
		const write = createTaxonomyAccessWithWrite(db);
		await expect(read.getTerms("genre")).rejects.toThrow("server-selected site");
		await expect(read.getEntryTerms("post", "entry")).rejects.toThrow("server-selected site");
		await expect(write.getTerms("genre")).rejects.toThrow("server-selected site");
		await expect(write.getEntryTerms("post", "entry")).rejects.toThrow("server-selected site");

		for (const [siteId, slug] of [
			["foo", "foo-term"],
			["bar", "bar-term"],
		]) {
			await runWithContext({ editMode: false, siteId }, () =>
				new TaxonomyRepository(db!).create({ name: "genre", slug, label: slug }),
			);
		}

		const readSlugs = async (siteId: string) =>
			runWithContext({ editMode: false, siteId }, async () =>
				(await read.getTerms("genre")).map((term) => term.slug),
			);

		expect(await readSlugs("foo")).toEqual(["foo-term"]);
		expect(await readSlugs("bar")).toEqual(["bar-term"]);
		expect(await readSlugs("foo")).toEqual(["foo-term"]);
	});
});
