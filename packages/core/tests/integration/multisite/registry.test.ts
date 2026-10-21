import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "kysely";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { setDefaultDnsResolver } from "../../../src/import/ssrf.js";
import {
	createRegisteredSite,
	getRegisteredSite,
	listRegisteredSites,
	updateRegisteredSiteTitle,
} from "../../../src/multisite/registry.js";
import { LocalStorage } from "../../../src/storage/local.js";
import {
	describeEachDialect,
	setupForDialect,
	setupForDialectWithCollections,
	teardownForDialect,
	type DialectName,
	type DialectTestContext,
} from "../../utils/test-db.js";

describeEachDialect("multisite registry service", (dialect: DialectName) => {
	let ctx: DialectTestContext;
	beforeEach(async () => {
		ctx = await setupForDialect(dialect);
	});
	afterEach(async () => teardownForDialect(ctx));

	it("lists all sites and updates a missing title without changing another site's settings", async () => {
		const { db } = ctx;
		await db
			.insertInto("_emdash_sites")
			.values([
				{ id: "site-alpha", slug: "alpha", active: 1 },
				{ id: "site-beta", slug: "beta", active: 0 },
			])
			.execute();
		await db
			.insertInto("_emdash_site_hosts")
			.values([
				{ hostname: "alpha.example.test", site_id: "site-alpha" },
				{ hostname: "beta.example.test", site_id: "site-beta" },
			])
			.execute();
		await db
			.insertInto("options")
			.values({
				name: "site:site-beta:title",
				value: JSON.stringify("Beta title"),
				site_id: "site-beta",
			})
			.execute();

		const sites = await listRegisteredSites(db);
		expect(sites).toEqual([
			expect.objectContaining({
				id: "site-alpha",
				slug: "alpha",
				status: "active",
				title: null,
				domains: ["alpha.example.test"],
			}),
			expect.objectContaining({
				id: "site-beta",
				slug: "beta",
				status: "disabled",
				title: "Beta title",
				domains: ["beta.example.test"],
			}),
			expect.objectContaining({ id: "site-default", slug: "default", status: "active" }),
		]);

		const changed = await updateRegisteredSiteTitle(db, {
			siteId: "site-alpha",
			title: "Alpha title",
			expectedRevision: null,
			actorId: "operator",
		});
		expect(changed.ok).toBe(true);
		expect((await getRegisteredSite(db, "site-alpha"))?.title).toBe("Alpha title");
		expect((await getRegisteredSite(db, "site-beta"))?.title).toBe("Beta title");
		expect(
			await updateRegisteredSiteTitle(db, {
				siteId: "site-missing",
				title: "No site",
				expectedRevision: null,
				actorId: "operator",
			}),
		).toEqual({ ok: false, reason: "not_found" });
	});

	it("bumps running export write epochs in the title transaction", async () => {
		const { db } = ctx;
		await db.insertInto("_emdash_sites").values({ id: "site-alpha", slug: "alpha" }).execute();
		const { TransferOperationRepository } =
			await import("../../../../src/transfer/ops/operations.js");
		const repo = new TransferOperationRepository(db);
		const { operation } = await repo.create({ kind: "export", createdBy: "operator" });
		await db
			.updateTable("_emdash_transfer_operations")
			.set({ state: "running" })
			.where("id", "=", operation.id)
			.execute();

		const changed = await updateRegisteredSiteTitle(db, {
			siteId: "site-alpha",
			title: "Alpha title",
			expectedRevision: null,
			actorId: "operator",
		});

		expect(changed.ok).toBe(true);
		expect((await repo.require(operation.id)).writeEpoch).toBe(1);
	});

	it("rolls back the title when its audit insert fails", async () => {
		const { db } = ctx;
		await db.insertInto("_emdash_sites").values({ id: "site-alpha", slug: "alpha" }).execute();
		await db
			.insertInto("options")
			.values({
				name: "site:site-alpha:title",
				value: JSON.stringify("Before"),
				site_id: "site-alpha",
			})
			.execute();
		const { TransferOperationRepository } =
			await import("../../../../src/transfer/ops/operations.js");
		const repo = new TransferOperationRepository(db);
		const { operation } = await repo.create({ kind: "export", createdBy: "operator" });
		await db
			.updateTable("_emdash_transfer_operations")
			.set({ state: "running" })
			.where("id", "=", operation.id)
			.execute();
		if (dialect === "postgres") {
			await sql`CREATE FUNCTION reject_registry_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END; $$`.execute(
				db,
			);
			await sql`CREATE TRIGGER reject_registry_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_registry_audit()`.execute(
				db,
			);
		} else {
			await sql`CREATE TRIGGER reject_registry_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`.execute(
				db,
			);
		}
		const before = await getRegisteredSite(db, "site-alpha");
		await expect(
			updateRegisteredSiteTitle(db, {
				siteId: "site-alpha",
				title: "After",
				expectedRevision: before?.titleRevision ?? null,
				actorId: "operator",
			}),
		).rejects.toThrow();
		expect((await getRegisteredSite(db, "site-alpha"))?.title).toBe("Before");
		expect((await repo.require(operation.id)).writeEpoch).toBe(0);
	});

	it("allows only one concurrent write with the same revision and records no title or credentials", async () => {
		const { db } = ctx;
		await db.insertInto("_emdash_sites").values({ id: "site-alpha", slug: "alpha" }).execute();
		await db
			.insertInto("options")
			.values({
				name: "site:site-alpha:title",
				value: JSON.stringify("Before"),
				site_id: "site-alpha",
			})
			.execute();
		const revision = (await getRegisteredSite(db, "site-alpha"))?.titleRevision ?? null;
		const results = await Promise.all([
			updateRegisteredSiteTitle(db, {
				siteId: "site-alpha",
				title: "First secret-looking title",
				expectedRevision: revision,
				actorId: "actor-one",
			}),
			updateRegisteredSiteTitle(db, {
				siteId: "site-alpha",
				title: "Second secret-looking title",
				expectedRevision: revision,
				actorId: "actor-two",
			}),
		]);
		expect(results.filter((result) => result.ok)).toHaveLength(1);
		expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "stale" }]);
		const logs = await db
			.selectFrom("audit_logs")
			.select(["actor_id", "resource_id", "timestamp", "details"])
			.execute();
		expect(logs).toHaveLength(1);
		expect(logs[0]).toMatchObject({ resource_id: "site-alpha" });
		expect(logs[0]?.actor_id).toMatch(/^actor-(one|two)$/);
		expect(logs[0]?.timestamp).toBeTruthy();
		expect(logs[0]?.details).not.toMatch(
			/First secret-looking title|Second secret-looking title|credential|password/i,
		);
	});
});

it.skipIf(!process.env.EMDASH_TEST_PG)(
	"removes only attempted media after a late site-creation rollback and retains it on retry",
	async () => {
		const context = await setupForDialectWithCollections("postgres");
		const directory = mkdtempSync(join(tmpdir(), "emdash-site-media-"));
		const storage = new LocalStorage({ directory, baseUrl: "http://storage.test" });
		const oldFetch = globalThis.fetch;
		const oldResolver = setDefaultDnsResolver(async () => ["93.184.216.34"]);
		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
		const fetchMock = vi.fn(
			async () => new Response(png, { status: 200, headers: { "content-type": "image/png" } }),
		);
		const storedKeys = (directoryPath: string, prefix = ""): string[] =>
			readdirSync(directoryPath).flatMap((name) => {
				const path = join(directoryPath, name);
				const key = prefix ? `${prefix}/${name}` : name;
				return statSync(path).isDirectory() ? storedKeys(path, key) : [key];
			});
		globalThis.fetch = fetchMock as typeof fetch;
		const seed = {
			version: "1",
			content: {
				post: [
					{
						id: "starter-post",
						slug: "starter-post",
						data: {
							title: "Starter",
							content: [
								{
									_type: "image",
									_key: "starter-image",
									asset: { $media: { url: "https://assets.example.test/starter.png" } },
								},
							],
						},
					},
				],
			},
		};
		const input = {
			title: "Media test",
			slug: "media-test",
			hostname: "media-test.example.test",
			siteUrl: "https://media-test.example.test",
			actorId: "operator",
			actorScope: "media-test",
			actorSource: "cli" as const,
			requestKey: "media-create-request-0001",
			seed,
			storage,
		};
		try {
			await storage.upload({ key: "existing/keep.png", body: png, contentType: "image/png" });
			await sql`CREATE FUNCTION reject_media_site_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'site_create' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END; $$`.execute(
				context.db,
			);
			await sql`CREATE TRIGGER reject_media_site_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_media_site_audit()`.execute(
				context.db,
			);
			await expect(createRegisteredSite(context.db, input)).rejects.toThrow();
			expect(storedKeys(directory)).toEqual(["existing/keep.png"]);
			await sql`DROP TRIGGER reject_media_site_audit ON audit_logs; DROP FUNCTION reject_media_site_audit()`.execute(
				context.db,
			);
			const site = await createRegisteredSite(context.db, input);
			const files = storedKeys(directory);
			expect(files).toHaveLength(2);
			expect(files).toContain("existing/keep.png");
			expect(fetchMock).toHaveBeenCalledTimes(2);
			await createRegisteredSite(context.db, input);
			expect(storedKeys(directory)).toHaveLength(2);
			expect(fetchMock).toHaveBeenCalledTimes(2);
			const mediaRows = await context.db
				.selectFrom("media")
				.select(["storage_key", "site_id"])
				.where("site_id", "=", site.id)
				.execute();
			expect(mediaRows).toHaveLength(1);
			expect(files).toContain(mediaRows[0]?.storage_key);
		} finally {
			globalThis.fetch = oldFetch;
			setDefaultDnsResolver(oldResolver);
			await teardownForDialect(context);
			rmSync(directory, { recursive: true, force: true });
		}
	},
);

it("loads the emitted registry module from the package build", async () => {
	const built = await import("emdash/internal/multisite/registry");
	expect(built.listRegisteredSites).toBeTypeOf("function");
	expect(built.getRegisteredSite).toBeTypeOf("function");
	expect(built.updateRegisteredSiteTitle).toBeTypeOf("function");
});
