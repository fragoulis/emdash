import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { validateMediaFields } from "../../../src/api/handlers/validate-media-fields.js";
import { MediaUsageRepository } from "../../../src/database/repositories/media-usage.js";
import { MediaRepository } from "../../../src/database/repositories/media.js";
import { runWithContext } from "../../../src/request-context.js";
import { getSectionById } from "../../../src/sections/index.js";
import { createReader } from "../../../src/transfer/export/readers.js";
import {
	hasPgTestDatabase,
	setupTestPostgresDatabase,
	teardownTestPostgresDatabase,
	type PgTestContext,
} from "../../utils/test-db.js";

const visit = <T>(siteId: string | undefined, fn: () => T) =>
	runWithContext({ editMode: false, siteId }, fn);

describe.skipIf(!hasPgTestDatabase)("PostgreSQL direct media boundaries", () => {
	let ctx: PgTestContext;
	afterEach(async () => {
		await teardownTestPostgresDatabase(ctx);
	});

	it("does not disclose a foreign section preview or export foreign media", async () => {
		ctx = await setupTestPostgresDatabase();
		await sql`INSERT INTO _emdash_sites (id, slug) VALUES ('site-foo', 'foo')`.execute(ctx.db);
		const foreign = await visit("site-default", () =>
			new MediaRepository(ctx.db).create({
				filename: "private.png",
				mimeType: "image/png",
				storageKey: "private.png",
			}),
		);
		await sql`INSERT INTO _emdash_sections (id, slug, title, content, source, preview_media_id)
			VALUES ('section', 'hero', 'Hero', '[]', 'user', ${foreign.id})`.execute(ctx.db);
		await visit("site-foo", async () => {
			expect((await getSectionById("section", ctx.db))?.previewUrl).toBeUndefined();
			const reader = createReader(ctx.db, "media", {
				mediaBlobs: async () => new Map([[foreign.id, `sha256:${"0".repeat(64)}`]]),
			});
			expect(await reader.byIds([foreign.id])).toEqual(new Map());
		});
		await visit("site-default", async () => {
			expect((await getSectionById("section", ctx.db))?.previewUrl).toBe(
				"/_emdash/media/private.png",
			);
		});
		await expect(getSectionById("section", ctx.db)).rejects.toThrow(/server-selected site/);
		const usage = new MediaUsageRepository(ctx.db);
		await visit("site-default", () =>
			usage.replaceSource(
				{
					sourceKey: "content:posts:entry:columns",
					sourceType: "content",
					collectionSlug: "posts",
					contentId: "entry",
					sourceVariant: "columns",
					contentStatus: "published",
				},
				[
					{
						fieldSlug: "hero",
						fieldPath: "hero",
						occurrenceIndex: 0,
						referenceType: "image_field",
						mediaId: foreign.id,
						provider: "local",
						providerAssetId: foreign.id,
						mediaKind: "image",
						mimeType: null,
					},
				],
			),
		);
		await visit("site-foo", async () => {
			expect(await usage.findCurrentUsageByMediaId(foreign.id)).toEqual([]);
		});
	}, 20_000);

	it("rejects foreign image references, including nested dark variants", async () => {
		ctx = await setupTestPostgresDatabase();
		await sql`INSERT INTO _emdash_sites (id, slug) VALUES ('site-foo', 'foo')`.execute(ctx.db);
		const collection = await ctx.db
			.insertInto("_emdash_collections")
			.values({ id: "posts", slug: "posts", label: "Posts" })
			.returningAll()
			.executeTakeFirstOrThrow();
		await ctx.db
			.insertInto("_emdash_fields")
			.values([
				{
					id: "hero",
					collection_id: collection.id,
					slug: "hero",
					label: "Hero",
					type: "image",
					column_type: "text",
					validation: JSON.stringify({ allowedMimeTypes: ["image/"] }),
				},
				{
					id: "attachment",
					collection_id: collection.id,
					slug: "attachment",
					label: "Attachment",
					type: "file",
					column_type: "text",
					validation: null,
				},
			])
			.execute();
		const repo = new MediaRepository(ctx.db);
		const foreign = await visit("site-default", () =>
			repo.create({ filename: "foreign.png", mimeType: "image/png", storageKey: "foreign.png" }),
		);
		const own = await visit("site-foo", () =>
			repo.create({ filename: "own.png", mimeType: "image/png", storageKey: "own.png" }),
		);
		await visit("site-foo", async () => {
			expect(
				(await validateMediaFields(ctx.db, "posts", { hero: { id: foreign.id } })).success,
			).toBe(false);
			expect(
				(await validateMediaFields(ctx.db, "posts", { attachment: { id: foreign.id } })).success,
			).toBe(false);
			expect(
				(
					await validateMediaFields(ctx.db, "posts", {
						hero: { id: own.id, darkVariant: { id: foreign.id } },
					})
				).success,
			).toBe(false);
			expect(await validateMediaFields(ctx.db, "posts", { hero: { id: own.id } })).toEqual({
				success: true,
				data: true,
			});
		});
	}, 20_000);
});
