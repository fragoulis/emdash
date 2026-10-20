import { describe, expect, it } from "vitest";

import {
	getRegisteredSite,
	listRegisteredSites,
	updateRegisteredSiteTitle,
} from "../../../src/multisite/registry.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

describe("multisite registry service", () => {
	it("lists disabled sites and updates only the title with a revision precondition and audit", async () => {
		const db = await setupTestDatabase();
		try {
			await db
				.insertInto("_emdash_sites")
				.values([
					{ id: "site-alpha", slug: "alpha", active: 1 },
					{ id: "site-beta", slug: "beta", active: 0 },
				])
				.execute();
			await db
				.insertInto("_emdash_site_hosts")
				.values({ hostname: "alpha.example.test", site_id: "site-alpha" })
				.execute();
			await db
				.insertInto("options")
				.values({
					name: "site:site-alpha:title",
					value: JSON.stringify("Alpha title"),
					site_id: "site-alpha",
				})
				.execute();

			const sites = await listRegisteredSites(db);
			expect(sites).toEqual([
				expect.objectContaining({
					id: "site-alpha",
					slug: "alpha",
					status: "active",
					title: "Alpha title",
					domains: ["alpha.example.test"],
				}),
				expect.objectContaining({
					id: "site-beta",
					slug: "beta",
					status: "disabled",
					title: null,
					domains: [],
				}),
				expect.objectContaining({ id: "site-default", slug: "default", status: "active" }),
			]);
			const current = await getRegisteredSite(db, "site-alpha");
			const changed = await updateRegisteredSiteTitle(db, {
				siteId: "site-alpha",
				title: "Updated",
				expectedRevision: current?.titleRevision ?? null,
				actorId: "operator",
			});
			expect(changed.ok).toBe(true);
			const stale = await updateRegisteredSiteTitle(db, {
				siteId: "site-alpha",
				title: "Lost update",
				expectedRevision: current?.titleRevision ?? null,
				actorId: "other",
			});
			expect(stale).toEqual({ ok: false, reason: "stale" });
			expect((await getRegisteredSite(db, "site-alpha"))?.title).toBe("Updated");
			const audit = await db
				.selectFrom("audit_logs")
				.select(["actor_id", "resource_id", "details"])
				.executeTakeFirstOrThrow();
			expect(audit).toMatchObject({ actor_id: "operator", resource_id: "site-alpha" });
			expect(audit.details).not.toContain("Updated");
		} finally {
			await teardownTestDatabase(db);
		}
	});
});
