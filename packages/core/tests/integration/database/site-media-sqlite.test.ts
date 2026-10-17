import { sql } from "kysely";
import { describe, expect, it } from "vitest";

import { up } from "../../../src/database/migrations/100_site_media.js";
import { createMigrator } from "../../../src/database/migrations/runner.js";
import { MediaFolderRepository } from "../../../src/database/repositories/media-folders.js";
import { runWithContext } from "../../../src/request-context.js";
import { createTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

describe("SQLite media ownership upgrade", () => {
	it("keeps existing folder assignments and attempts on retry, and allows equal folder names on separate sites", async () => {
		const db = createTestDatabase();
		try {
			const { error } = await createMigrator(db).migrateTo("099_site_menus");
			if (error) throw error;
			await sql`INSERT INTO media_folders (id, name, name_key) VALUES ('old-folder', 'Pictures', 'pictures')`.execute(
				db,
			);
			await sql`INSERT INTO media (id, filename, mime_type, storage_key, status, folder_id)
				VALUES ('old-media', 'old.jpg', 'image/jpeg', 'old-key', 'pending', 'old-folder')`.execute(
				db,
			);
			await sql`INSERT INTO _emdash_media_upload_attempts (media_id, storage_key, status)
				VALUES ('old-media', 'old-key', 'active')`.execute(db);
			await sql`INSERT INTO _emdash_bylines (id, slug, display_name, avatar_media_id)
				VALUES ('old-author', 'old-author', 'Old Author', 'old-media')`.execute(db);
			await up(db);
			await up(db);
			const media = await sql<{
				folder_id: string;
			}>`SELECT folder_id FROM media WHERE id = 'old-media'`.execute(db);
			expect(media.rows).toEqual([{ folder_id: "old-folder" }]);
			const avatars = await sql<{
				avatar_media_id: string;
			}>`SELECT avatar_media_id FROM _emdash_bylines WHERE id = 'old-author'`.execute(db);
			expect(avatars.rows).toEqual([{ avatar_media_id: "old-media" }]);
			const attempts = await sql<{
				site_id: string;
			}>`SELECT site_id FROM _emdash_media_upload_attempts`.execute(db);
			expect(attempts.rows).toEqual([{ site_id: "site-default" }]);
			await expect(
				sql`INSERT INTO media (id, filename, mime_type, storage_key, status)
				VALUES ('no-site', 'new.jpg', 'image/jpeg', 'new-media-key', 'ready')`.execute(db),
			).rejects.toThrow();
			await expect(
				sql`INSERT INTO media_folders (id, name, name_key)
				VALUES ('no-site', 'New', 'new')`.execute(db),
			).rejects.toThrow();
			await expect(
				sql`INSERT INTO _emdash_media_upload_attempts (media_id, storage_key, status)
				VALUES ('new', 'new-key', 'active')`.execute(db),
			).rejects.toThrow();
			await sql`INSERT INTO _emdash_sites (id, slug) VALUES ('site-other', 'other')`.execute(db);
			const folders = new MediaFolderRepository(db);
			const other = await runWithContext({ editMode: false, siteId: "site-other" }, () =>
				folders.create("Pictures"),
			);
			expect(other.id).not.toBe("old-folder");
			expect(
				await runWithContext({ editMode: false, siteId: "site-default" }, () => folders.findMany()),
			).toEqual({ items: [{ id: "old-folder", name: "Pictures" }], nextCursor: undefined });
		} finally {
			await teardownTestDatabase(db);
		}
	});
});
