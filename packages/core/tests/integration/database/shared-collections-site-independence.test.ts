import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { up as migrateSharedCollections } from "../../../src/database/migrations/101_shared_collection_definitions.js";
import { SchemaRegistry } from "../../../src/schema/registry.js";
import {
	PG_CONNECTION_STRING,
	setupTestDatabase,
	setupTestPostgresDatabase,
	teardownTestDatabase,
	teardownTestPostgresDatabase,
} from "../../utils/test-db.js";

const describePg = PG_CONNECTION_STRING ? describe : describe.skip;

describe("shared collection definitions", () => {
	it("creates shared collection definitions without a compatibility site owner", async () => {
		const db = await setupTestDatabase();
		try {
			const registry = new SchemaRegistry(db);
			await registry.createCollection({ slug: "shared", label: "Shared" });
			await registry.createField("shared", { slug: "title", label: "Title", type: "string" });
			await db
				.updateTable("_emdash_collections")
				.set({ site_id: "site-default" })
				.where("slug", "=", "shared")
				.execute();
			await db.schema
				.alterTable("_emdash_collections")
				.renameColumn("site_id", "site_id_101_old")
				.execute();
			await db.schema.alterTable("_emdash_collections").addColumn("site_id", "text").execute();
			await migrateSharedCollections(db);
			await migrateSharedCollections(db);
			const collection = await db
				.selectFrom("_emdash_collections")
				.select(["site_id", "slug"])
				.where("slug", "=", "shared")
				.executeTakeFirstOrThrow();
			expect(collection).toEqual({ site_id: "site-default", slug: "shared" });
			await expect(registry.getCollection("shared")).resolves.toMatchObject({ slug: "shared" });
			await registry.createField("shared", { slug: "summary", label: "Summary", type: "text" });
			const foreignKeyCheck = await sql<{ table: string }>`PRAGMA foreign_key_check`.execute(db);
			expect(foreignKeyCheck.rows).toEqual([]);
		} finally {
			await teardownTestDatabase(db);
		}
	});
});

describePg("PostgreSQL shared collection definitions", () => {
	let db: Awaited<ReturnType<typeof setupTestPostgresDatabase>>["db"] | undefined;
	let schemaName: string | undefined;

	afterEach(async () => {
		if (db && schemaName) await teardownTestPostgresDatabase({ db, schemaName });
		db = undefined;
		schemaName = undefined;
	});

	it("creates shared collection definitions without a compatibility site owner", async () => {
		const context = await setupTestPostgresDatabase();
		db = context.db;
		schemaName = context.schemaName;

		const registry = new SchemaRegistry(db);
		await registry.createCollection({ slug: "shared", label: "Shared" });

		const collection = await db
			.selectFrom("_emdash_collections")
			.select(["site_id", "slug"])
			.where("slug", "=", "shared")
			.executeTakeFirstOrThrow();
		expect(collection).toEqual({ site_id: null, slug: "shared" });
		const column = await sql<{ is_nullable: string; column_default: string | null }>`
			SELECT is_nullable, column_default FROM information_schema.columns
			WHERE table_schema = current_schema() AND table_name = '_emdash_collections' AND column_name = 'site_id'
		`.execute(db);
		expect(column.rows).toEqual([{ is_nullable: "YES", column_default: null }]);
	}, 30_000);
});
