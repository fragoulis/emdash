import { Role } from "@emdash-cms/auth";
import type { APIContext } from "astro";
import { sql } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";

import {
	handleContentCreate,
	handleContentDelete,
	handleContentGet,
	handleContentList,
	handleContentPublish,
	handleContentRestore,
	handleContentSchedule,
	handleContentUpdate,
} from "../../../src/api/handlers/content.js";
import { handleRevisionGet, handleRevisionList } from "../../../src/api/handlers/revision.js";
import {
	GET as getEntry,
	PUT as putEntry,
} from "../../../src/astro/routes/api/content/[collection]/[id].js";
import { POST as publishEntry } from "../../../src/astro/routes/api/content/[collection]/[id]/publish.js";
import {
	GET as listEntries,
	POST as postEntry,
} from "../../../src/astro/routes/api/content/[collection]/index.js";
import { GET as getRevision } from "../../../src/astro/routes/api/revisions/[revisionId]/index.js";
import { BylineRepository } from "../../../src/database/repositories/byline.js";
import { ContentRepository } from "../../../src/database/repositories/content.js";
import { RevisionRepository } from "../../../src/database/repositories/revision.js";
import { UserRepository } from "../../../src/database/repositories/user.js";
import { runWithContext } from "../../../src/request-context.js";
import { publishDueContent } from "../../../src/scheduled-publish.js";
import { SchemaRegistry } from "../../../src/schema/registry.js";
import { createTestRuntime } from "../../utils/mcp-runtime.js";
import {
	describeEachDialect,
	setupForDialect,
	teardownForDialect,
	type DialectTestContext,
} from "../../utils/test-db.js";

describeEachDialect("editorial content sites", (dialect) => {
	let ctx: DialectTestContext;

	beforeEach(async () => {
		ctx = await setupForDialect(dialect);
		const registry = new SchemaRegistry(ctx.db);
		await registry.createCollection({ slug: "posts", label: "Posts", labelSingular: "Post" });
		await registry.createField("posts", { slug: "title", label: "Title", type: "string" });
		await sql`INSERT INTO _emdash_sites (id, slug) VALUES ('site-foo', 'foo'), ('site-bar', 'bar')`.execute(
			ctx.db,
		);
		await sql`INSERT INTO ec_posts (id, site_id, slug, status, locale, translation_group, title)
			VALUES ('foo-id', 'site-foo', 'foo-only', 'draft', 'en', 'foo-id', 'Foo'),
			('bar-id', 'site-bar', 'shared', 'draft', 'en', 'bar-id', 'Bar')`.execute(ctx.db);
	});

	afterEach(async () => teardownForDialect(ctx));

	function within<T>(siteId: string, fn: () => Promise<T>): Promise<T> {
		return runWithContext({ editMode: false, db: ctx.db, siteId }, fn);
	}

	it("routes editor API edits for both sites through the trusted site context", async () => {
		const runtime = createTestRuntime(ctx.db);
		const editor = { id: "editor-id", role: Role.EDITOR };
		function request(method: string, path: string, body?: object): APIContext {
			const url = new URL(`http://localhost/_emdash/api/${path}`);
			return {
				params: {
					collection: "posts",
					id: path.split("/")[2],
					revisionId: path.split("/").at(-1),
				},
				request: new Request(url, {
					method,
					...(body
						? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
						: {}),
				}),
				url,
				locals: { emdash: runtime, user: editor },
				cache: { enabled: false },
			} as unknown as APIContext;
		}

		for (const [siteId, otherId] of [
			["site-foo", "bar-id"],
			["site-bar", "foo-id"],
		] as const) {
			await within(siteId, async () => {
				const created = await postEntry(
					request("POST", "content/posts", { data: { title: siteId } }),
				);
				expect(created.status).toBe(201);
				const id = (await created.json()).data.item.id as string;
				const list = await listEntries(request("GET", "content/posts"));
				expect((await list.json()).data.items.map((item: { id: string }) => item.id)).toContain(id);
				const updated = await putEntry(
					request("PUT", `content/posts/${id}`, { data: { title: "Edited" } }),
				);
				expect(updated.status).toBe(200);
				const own = await getEntry(request("GET", `content/posts/${id}`));
				expect((await own.json()).data.item.data.title).toBe("Edited");
				const published = await publishEntry(request("POST", `content/posts/${id}/publish`));
				expect(published.status).toBe(200);
				const foreign = await getEntry(request("GET", `content/posts/${otherId}`));
				expect(foreign.status).toBe(404);
				const denied = await putEntry(
					request("PUT", `content/posts/${otherId}`, { data: { title: "Stolen" } }),
				);
				expect(denied.status).toBe(404);
				expect(
					(await publishEntry(request("POST", `content/posts/${otherId}/publish`))).status,
				).toBe(404);
				const foreignTranslation = await postEntry(
					request("POST", "content/posts", {
						data: { title: "Stolen translation" },
						locale: "fr",
						translationOf: otherId,
					}),
				);
				expect(foreignTranslation.status).toBe(404);
				const rows = await sql<{ id: string; site_id: string; title: string; status: string }>`
					SELECT id, site_id, title, status FROM ec_posts WHERE id IN (${id}, ${otherId}) ORDER BY id
				`.execute(ctx.db);
				expect(rows.rows.find((row) => row.id === id)).toMatchObject({
					site_id: siteId,
					title: "Edited",
					status: "published",
				});
				expect(rows.rows.find((row) => row.id === otherId)?.title).not.toBe("Stolen");
			});
		}
		const revision = await within("site-bar", () =>
			new RevisionRepository(ctx.db).create({
				collection: "posts",
				entryId: "bar-id",
				data: { title: "Private" },
			}),
		);
		const denied = await within("site-foo", () =>
			getRevision(request("GET", `revisions/${revision.id}`)),
		);
		expect(denied.status).toBe(404);
	});

	it("lists and reads only entries belonging to the trusted site", async () => {
		for (const [siteId, ownId, otherId] of [
			["site-foo", "foo-id", "bar-id"],
			["site-bar", "bar-id", "foo-id"],
		] as const) {
			const list = await within(siteId, () => handleContentList(ctx.db, "posts", {}));
			expect(list.success && list.data.items.map((item) => item.id)).toEqual([ownId]);
			const own = await within(siteId, () => handleContentGet(ctx.db, "posts", ownId));
			expect(own.success && own.data.item.id).toBe(ownId);
			const denied = await within(siteId, () => handleContentGet(ctx.db, "posts", otherId));
			expect(denied.success).toBe(false);
		}
	});

	it("creates in the selected site and rejects a foreign translation source", async () => {
		const created = await within("site-foo", () =>
			handleContentCreate(ctx.db, "posts", { data: { title: "New" }, slug: "shared" }),
		);
		expect(created.success, JSON.stringify(created)).toBe(true);
		if (!created.success) return;
		const row = await sql<{
			site_id: string;
		}>`SELECT site_id FROM ec_posts WHERE id = ${created.data.item.id}`.execute(ctx.db);
		expect(row.rows[0]?.site_id).toBe("site-foo");
		const foreign = await within("site-bar", () =>
			handleContentCreate(ctx.db, "posts", {
				data: { title: "Foreign translation" },
				locale: "fr",
				translationOf: created.data.item.id,
			}),
		);
		expect(foreign.success).toBe(false);
	});

	it("keeps localized, scheduled, and published entries in their owning site", async () => {
		const translated = await within("site-foo", () =>
			handleContentCreate(ctx.db, "posts", {
				data: { title: "Bonjour" },
				slug: "bonjour",
				locale: "fr",
				translationOf: "foo-id",
			}),
		);
		expect(translated.success).toBe(true);
		if (!translated.success) return;
		const id = translated.data.item.id;
		const scheduled = await within("site-foo", () =>
			handleContentSchedule(ctx.db, "posts", id, "2030-01-01T00:00:00.000Z"),
		);
		expect(scheduled.success).toBe(true);
		const hidden = await within("site-bar", () => handleContentGet(ctx.db, "posts", id));
		expect(hidden.success).toBe(false);
		const published = await within("site-foo", () => handleContentPublish(ctx.db, "posts", id));
		expect(published.success).toBe(true);
		const row = await sql<{ site_id: string; status: string }>`
			SELECT site_id, status FROM ec_posts WHERE id = ${id}
		`.execute(ctx.db);
		expect(row.rows[0]).toMatchObject({ site_id: "site-foo", status: "published" });
	});

	it("publishes due scheduled entries for both sites from a request-less sweep", async () => {
		for (const [siteId, id] of [
			["site-foo", "foo-id"],
			["site-bar", "bar-id"],
		] as const) {
			const scheduled = await within(siteId, () =>
				handleContentSchedule(
					ctx.db,
					"posts",
					id,
					"2030-01-01T00:00:00.000Z",
					new Date("2029-01-01T00:00:00.000Z"),
				),
			);
			expect(scheduled.success, JSON.stringify(scheduled)).toBe(true);
		}
		const published = await publishDueContent(ctx.db, {
			currentTime: new Date("2030-01-02T00:00:00.000Z"),
		});
		expect(published.map((item) => item.id).toSorted()).toEqual(["bar-id", "foo-id"]);
		const rows = await sql<{ id: string; site_id: string; status: string }>`
			SELECT id, site_id, status FROM ec_posts ORDER BY id
		`.execute(ctx.db);
		expect(rows.rows).toEqual([
			{ id: "bar-id", site_id: "site-bar", status: "published" },
			{ id: "foo-id", site_id: "site-foo", status: "published" },
		]);
	});

	it("hides another site's revision history and revision IDs", async () => {
		const revision = await within("site-bar", () =>
			new RevisionRepository(ctx.db).create({
				collection: "posts",
				entryId: "bar-id",
				data: { title: "Secret draft" },
			}),
		);
		const list = await within("site-foo", () => handleRevisionList(ctx.db, "posts", "bar-id"));
		expect(list.success).toBe(false);
		const get = await within("site-foo", () => handleRevisionGet(ctx.db, revision.id));
		expect(get.success).toBe(false);
		const own = await within("site-bar", () => handleRevisionGet(ctx.db, revision.id));
		expect(own.success && own.data.item.data.title).toBe("Secret draft");
	});

	it("keeps byline profiles and linked credits within their site", async () => {
		const byline = await within("site-bar", () =>
			new BylineRepository(ctx.db).create({ slug: "bar-editor", displayName: "Bar Editor" }),
		);
		const foo = await within("site-foo", () => new BylineRepository(ctx.db).findById(byline.id));
		expect(foo).toBeNull();
		await expect(
			within("site-foo", () =>
				new BylineRepository(ctx.db).setContentBylines("posts", "foo-id", [
					{ bylineId: byline.id },
				]),
			),
		).rejects.toThrow();
		const unchanged = await sql<{
			primary_byline_id: string | null;
		}>`SELECT primary_byline_id FROM ec_posts WHERE id = 'foo-id'`.execute(ctx.db);
		expect(unchanged.rows[0]?.primary_byline_id).toBeNull();
	});

	it("does not use another site's author byline in content filters", async () => {
		const user = await new UserRepository(ctx.db).create({
			email: "shared-author@example.com",
			name: "Shared Author",
		});
		await sql`UPDATE ec_posts SET author_id = ${user.id} WHERE id = 'foo-id'`.execute(ctx.db);
		await within("site-bar", () =>
			new BylineRepository(ctx.db).create({
				slug: "bar-author",
				displayName: "Bar Author",
				userId: user.id,
			}),
		);
		const result = await within("site-foo", () =>
			new ContentRepository(ctx.db).findMany("posts", {
				where: { bylineFilter: { mode: "none", includeInferred: true } },
			}),
		);
		expect(result.items.map((item) => item.id)).toContain("foo-id");
	});

	it("prevents cross-site trash and restore while preserving the owner's draft", async () => {
		const foreignDelete = await within("site-foo", () =>
			handleContentDelete(ctx.db, "posts", "bar-id"),
		);
		expect(foreignDelete.success).toBe(false);
		const deleted = await within("site-bar", () => handleContentDelete(ctx.db, "posts", "bar-id"));
		expect(deleted.success).toBe(true);
		const foreignRestore = await within("site-foo", () =>
			handleContentRestore(ctx.db, "posts", "bar-id"),
		);
		expect(foreignRestore.success).toBe(false);
		const restored = await within("site-bar", () =>
			handleContentRestore(ctx.db, "posts", "bar-id"),
		);
		expect(restored.success && restored.data.item.status).toBe("draft");
	});

	it("cannot update an entry belonging to another site", async () => {
		const result = await within("site-foo", () =>
			handleContentUpdate(ctx.db, "posts", "bar-id", { data: { title: "Changed" } }),
		);
		expect(result.success).toBe(false);
		const row = await sql<{
			title: string;
		}>`SELECT title FROM ec_posts WHERE id = 'bar-id'`.execute(ctx.db);
		expect(row.rows[0]?.title).toBe("Bar");
	});
});
