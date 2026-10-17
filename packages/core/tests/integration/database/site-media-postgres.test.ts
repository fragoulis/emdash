import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { runSystemCleanup } from "../../../src/cleanup.js";
import { up } from "../../../src/database/migrations/100_site_media.js";
import { createMigrator } from "../../../src/database/migrations/runner.js";
import { MediaFolderRepository } from "../../../src/database/repositories/media-folders.js";
import { MediaRepository } from "../../../src/database/repositories/media.js";
import { runWithContext } from "../../../src/request-context.js";
import {
	createTestPostgresDatabase,
	hasPgTestDatabase,
	setupTestPostgresDatabase,
	teardownTestPostgresDatabase,
	type PgTestContext,
} from "../../utils/test-db.js";

describe.skipIf(!hasPgTestDatabase)("PostgreSQL media site ownership", () => {
	let ctx: PgTestContext;

	afterEach(async () => {
		await teardownTestPostgresDatabase(ctx);
	});

	it("backfills existing media, folders, and upload attempts and resumes after a partial migration", async () => {
		ctx = await createTestPostgresDatabase();
		const { error } = await createMigrator(ctx.db, {
			migrationTableSchema: ctx.schemaName,
		}).migrateTo("099_site_menus");
		if (error) throw error;
		await sql`INSERT INTO media_folders (id, name, name_key) VALUES ('old-folder', 'Pictures', 'pictures')`.execute(
			ctx.db,
		);
		await sql`INSERT INTO media (id, filename, mime_type, storage_key, status, folder_id)
			VALUES ('old-media', 'old.jpg', 'image/jpeg', 'old-key', 'pending', 'old-folder')`.execute(
			ctx.db,
		);
		await sql`INSERT INTO _emdash_media_upload_attempts (media_id, storage_key, status)
			VALUES ('old-media', 'old-key', 'active')`.execute(ctx.db);
		await sql`ALTER TABLE media_folders ADD COLUMN site_id text`.execute(ctx.db);
		await sql`UPDATE media_folders SET site_id = 'site-default'`.execute(ctx.db);
		await up(ctx.db);
		await up(ctx.db);
		for (const table of ["media", "media_folders", "_emdash_media_upload_attempts"]) {
			const rows = await sql<{ site_id: string }>`SELECT site_id FROM ${sql.ref(table)}`.execute(
				ctx.db,
			);
			expect(rows.rows).toEqual([{ site_id: "site-default" }]);
		}
		await expect(
			sql`INSERT INTO media (id, filename, mime_type, storage_key, status)
			VALUES ('missing-site', 'new.jpg', 'image/jpeg', 'new-key', 'ready')`.execute(ctx.db),
		).rejects.toThrow();
		await expect(
			sql`INSERT INTO media_folders (id, name, name_key)
			VALUES ('missing-site', 'New', 'new')`.execute(ctx.db),
		).rejects.toThrow();
	});

	it("cleans pending uploads for every registered site without a request site", async () => {
		ctx = await setupTestPostgresDatabase();
		await sql`INSERT INTO _emdash_sites (id, slug) VALUES ('site-foo', 'foo'), ('site-bar', 'bar')`.execute(
			ctx.db,
		);
		const repo = new MediaRepository(ctx.db);
		for (const siteId of ["site-foo", "site-bar"]) {
			const pending = await runWithContext({ editMode: false, siteId }, () =>
				repo.createPending({
					filename: `${siteId}.png`,
					mimeType: "image/png",
					storageKey: `${siteId}/pending`,
				}),
			);
			await sql`UPDATE media SET created_at = '2000-01-01' WHERE id = ${pending.id}`.execute(
				ctx.db,
			);
		}
		const result = await runWithContext({ editMode: false, siteId: "site-foo" }, () =>
			runSystemCleanup(ctx.db),
		);
		expect(result.pendingUploads).toBe(2);
		expect((await sql`SELECT id FROM media WHERE status = 'pending'`.execute(ctx.db)).rows).toEqual(
			[],
		);
	});

	it("denies cross-site reads, edits, folder assignments, and upload attempt access", async () => {
		ctx = await setupTestPostgresDatabase();
		await sql`INSERT INTO _emdash_sites (id, slug) VALUES ('site-foo', 'foo'), ('site-bar', 'bar')`.execute(
			ctx.db,
		);
		const visit = <T>(siteId: string, fn: () => T) =>
			runWithContext({ editMode: false, siteId }, fn);
		const repo = new MediaRepository(ctx.db);
		const folders = new MediaFolderRepository(ctx.db);
		const fooFolder = await visit("site-foo", () => folders.create("Pictures"));
		const barFolder = await visit("site-bar", () => folders.create("Pictures"));
		const foo = await visit("site-foo", () =>
			repo.create({
				filename: "same.jpg",
				mimeType: "image/jpeg",
				storageKey: "foo/key",
				folderId: fooFolder.id,
			}),
		);
		const bar = await visit("site-bar", () =>
			repo.create({
				filename: "same.jpg",
				mimeType: "image/jpeg",
				storageKey: "bar/key",
				folderId: barFolder.id,
			}),
		);
		await visit("site-foo", () => repo.createUploadAttempt(foo.id, "foo/upload"));
		await visit("site-bar", async () => {
			expect(await repo.findById(foo.id)).toBeNull();
			expect(await repo.findByFilename(foo.filename)).toEqual(
				expect.objectContaining({ id: bar.id }),
			);
			expect(await repo.findMany()).toEqual({
				items: [expect.objectContaining({ id: bar.id })],
				nextCursor: undefined,
			});
			expect(await repo.update(foo.id, { alt: "stolen" })).toBeNull();
			expect(await repo.delete(foo.id)).toBe(false);
			expect(await folders.findById(fooFolder.id)).toBeNull();
			expect(await folders.delete(fooFolder.id)).toBe(false);
			expect(await repo.hasUploadAttempt("foo/upload")).toBe(false);
			await expect(repo.createUploadAttempt(foo.id, "bar/stolen")).rejects.toThrow(/selected site/);
			await expect(
				repo.create({
					filename: "bad",
					mimeType: "image/jpeg",
					storageKey: "bad/key",
					folderId: fooFolder.id,
				}),
			).rejects.toThrow(/selected site/);
		});
		expect(await visit("site-foo", () => repo.findById(foo.id))).toEqual(
			expect.objectContaining({ id: foo.id, alt: null }),
		);
		await expect(repo.findById(foo.id)).rejects.toThrow(/server-selected site/);
	});
});
