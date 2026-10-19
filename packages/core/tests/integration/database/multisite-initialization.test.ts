import { afterEach, describe, expect, it } from "vitest";

import { ContentRepository } from "../../../src/database/repositories/content.js";
import { SiteSettingsRepository } from "../../../src/database/repositories/site-settings.js";
import { initializeMultisiteDatabase } from "../../../src/multisite/initialize.js";
import { runWithContext } from "../../../src/request-context.js";
import { SchemaRegistry } from "../../../src/schema/registry.js";
import {
	createTestPostgresDatabase,
	PG_CONNECTION_STRING,
	setupTestPostgresDatabase,
	teardownTestPostgresDatabase,
} from "../../utils/test-db.js";

const describePg = PG_CONNECTION_STRING ? describe : describe.skip;
const richSeed = {
	version: "1" as const,
	defaultLocale: "en",
	settings: { title: "Seeded title", tagline: "Seeded tagline" },
	collections: [
		{
			slug: "article",
			label: "Articles",
			fields: [{ slug: "title", label: "Title", type: "string" as const }],
		},
	],
	taxonomies: [
		{
			name: "topics",
			label: "Topics",
			hierarchical: false,
			collections: ["article"],
			terms: [{ slug: "news", label: "News" }],
		},
	],
	bylines: [{ id: "author", slug: "author", displayName: "Seed Author" }],
	content: {
		article: [
			{
				id: "seed-entry",
				slug: "seed-entry",
				status: "published" as const,
				data: { title: "Seed entry" },
			},
		],
	},
	menus: [{ name: "primary", label: "Primary", items: [] }],
};

describePg("multisite database initialization", () => {
	const contexts: Array<Awaited<ReturnType<typeof createTestPostgresDatabase>>> = [];

	afterEach(async () => {
		for (const context of contexts.splice(0)) await teardownTestPostgresDatabase(context);
	});

	it("initializes shared definitions without registering a site or applying site seed data", async () => {
		const context = await createTestPostgresDatabase();
		contexts.push(context);
		const result = await initializeMultisiteDatabase(context.db, richSeed);

		expect(result.fresh).toBe(true);
		expect(await context.db.selectFrom("_emdash_sites").selectAll().execute()).toEqual([]);
		expect(
			await context.db.selectFrom("_emdash_collections").select(["slug", "site_id"]).execute(),
		).toEqual([{ slug: "article", site_id: null }]);
		expect(await context.db.selectFrom("taxonomies").selectAll().execute()).toEqual([]);
		expect(await context.db.selectFrom("_emdash_bylines").selectAll().execute()).toEqual([]);
		expect(await context.db.selectFrom("_emdash_menus").selectAll().execute()).toEqual([]);
		expect(await context.db.selectFrom("ec_article").selectAll().execute()).toEqual([]);
		const siteSetting = await runWithContext({ siteId: "site-default", editMode: false }, () =>
			new SiteSettingsRepository(context.db).get("title"),
		);
		expect(siteSetting).toBeUndefined();
		const setup = await context.db
			.selectFrom("options")
			.select("value")
			.where("name", "=", "emdash:setup_complete")
			.executeTakeFirstOrThrow();
		expect(JSON.parse(setup.value)).toBe(true);

		const repeated = await initializeMultisiteDatabase(context.db, {
			version: "1",
			collections: [{ slug: "second", label: "Second", fields: [] }],
		});
		expect(repeated.fresh).toBe(false);
		expect(await context.db.selectFrom("_emdash_collections").select("slug").execute()).toEqual([
			{ slug: "article" },
		]);
	}, 30_000);

	it("rolls back a failed fresh seed and can retry cleanly", async () => {
		const context = await createTestPostgresDatabase();
		contexts.push(context);
		await expect(
			initializeMultisiteDatabase(context.db, {
				version: "1",
				collections: [{ slug: "Not Valid", label: "Broken", fields: [] }],
			}),
		).rejects.toThrow(/Invalid seed file/);

		const result = await initializeMultisiteDatabase(context.db, richSeed);
		expect(result.fresh).toBe(true);
		expect(await context.db.selectFrom("_emdash_sites").selectAll().execute()).toEqual([]);
	}, 30_000);

	it("serializes concurrent fresh starts", async () => {
		const context = await createTestPostgresDatabase();
		contexts.push(context);
		const seed = {
			version: "1" as const,
			collections: [{ slug: "article", label: "Articles", fields: [] }],
		};
		const results = await Promise.all([
			initializeMultisiteDatabase(context.db, seed),
			initializeMultisiteDatabase(context.db, seed),
		]);
		expect(
			results.map((result) => result.fresh).toSorted((left, right) => Number(left) - Number(right)),
		).toEqual([false, true]);
		expect(await context.db.selectFrom("_emdash_sites").selectAll().execute()).toEqual([]);
		expect(await context.db.selectFrom("_emdash_collections").selectAll().execute()).toHaveLength(
			1,
		);
	}, 30_000);

	it("runs pending migrations without changing existing site settings or content", async () => {
		const context = await setupTestPostgresDatabase();
		contexts.push(context);
		const registry = new SchemaRegistry(context.db);
		await registry.createCollection({ slug: "legacy", label: "Legacy" });
		await registry.createField("legacy", { slug: "title", label: "Title", type: "string" });
		await context.db
			.updateTable("_emdash_collections")
			.set({ site_id: "site-default" })
			.where("slug", "=", "legacy")
			.execute();
		await runWithContext({ siteId: "site-default", editMode: false }, async () => {
			await new SiteSettingsRepository(context.db).set("title", "Original title");
			await new ContentRepository(context.db).create({
				type: "legacy",
				slug: "preserved-entry",
				data: { title: "Preserved entry" },
			});
		});

		const result = await initializeMultisiteDatabase(context.db, richSeed);
		expect(result.fresh).toBe(false);
		expect(await context.db.selectFrom("_emdash_sites").selectAll().execute()).toHaveLength(1);
		await expect(registry.getCollection("legacy")).resolves.toMatchObject({ slug: "legacy" });
		await expect(registry.getCollection("article")).resolves.toBeNull();
		await expect(
			runWithContext({ siteId: "site-default", editMode: false }, () =>
				new SiteSettingsRepository(context.db).get("title"),
			),
		).resolves.toBe("Original title");
		await expect(
			runWithContext({ siteId: "site-default", editMode: false }, () =>
				new ContentRepository(context.db).findBySlug("legacy", "preserved-entry"),
			),
		).resolves.toMatchObject({ data: { title: "Preserved entry" } });
	}, 30_000);
});
