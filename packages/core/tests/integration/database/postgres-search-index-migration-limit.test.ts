import { beforeEach, afterEach, describe, expect, it } from "vitest";

import { CONTENT_SIZED_MIGRATIONS } from "../../../src/database/migrations/content-sized.js";
import { ContentRepository } from "../../../src/database/repositories/content.js";
import { runWithContext } from "../../../src/request-context.js";
import { createPostFixture } from "../../utils/fixtures.js";
import {
	hasPgTestDatabase,
	setupTestPostgresDatabaseWithCollections,
	teardownTestPostgresDatabase,
} from "../../utils/test-db.js";

const describePg = hasPgTestDatabase ? describe : describe.skip;

describePg("PostgreSQL search index migration size", () => {
	let ctx: Awaited<ReturnType<typeof setupTestPostgresDatabaseWithCollections>>;
	let content: ContentRepository;

	beforeEach(async () => {
		ctx = await setupTestPostgresDatabaseWithCollections();
		content = new ContentRepository(ctx.db);
		await ctx.db
			.insertInto("_emdash_sites")
			.values([
				{ id: "site-a", slug: "site-a", active: 1 },
				{ id: "site-b", slug: "site-b", active: 1 },
			])
			.execute();
		await ctx.db
			.updateTable("_emdash_collections")
			.set({ search_config: JSON.stringify({ enabled: true }) })
			.where("slug", "=", "post")
			.execute();
	}, 30_000);

	afterEach(async () => teardownTestPostgresDatabase(ctx), 30_000);

	it("counts eligible content across sites and stops at the supplied cap", async () => {
		for (const siteId of ["site-a", "site-b"]) {
			await runWithContext({ editMode: false, siteId }, () =>
				content.create(
					createPostFixture({
						slug: `search-${siteId}`,
						title: "Search content",
						status: "published",
					}),
				),
			);
		}

		const countRows = CONTENT_SIZED_MIGRATIONS.get("104_postgres_search_index")?.countRows;
		expect(countRows).toBeDefined();
		await expect(countRows!(ctx.db, 1)).resolves.toBe(1);
		await expect(countRows!(ctx.db, 10)).resolves.toBe(2);

		await ctx.db
			.updateTable("_emdash_collections")
			.set({ search_config: JSON.stringify({ enabled: false }) })
			.where("slug", "=", "post")
			.execute();
		await expect(countRows!(ctx.db, 10)).resolves.toBe(0);
	});
});
