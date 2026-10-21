import { createServer } from "node:http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as searchGet } from "../../../src/astro/routes/api/search/index.js";
import { POST as rebuildPost } from "../../../src/astro/routes/api/search/rebuild.js";
import { GET as statsGet } from "../../../src/astro/routes/api/search/stats.js";
import { GET as suggestGet } from "../../../src/astro/routes/api/search/suggest.js";
import { ContentRepository } from "../../../src/database/repositories/content.js";
import { UserRepository } from "../../../src/database/repositories/user.js";
import { runWithContext } from "../../../src/request-context.js";
import { SchemaRegistry } from "../../../src/schema/registry.js";
import { FTSManager } from "../../../src/search/fts-manager.js";
import { createPostFixture } from "../../utils/fixtures.js";
import {
	hasPgTestDatabase,
	setupTestPostgresDatabaseWithCollections,
	teardownTestPostgresDatabase,
} from "../../utils/test-db.js";

const describePg = hasPgTestDatabase ? describe : describe.skip;

type HttpOptions = {
	method?: "GET" | "POST";
	body?: unknown;
	user?: { id: string; role: number };
	locale?: string;
	status?: string;
	spoofSiteHeader?: string;
};

describePg("PostgreSQL public search HTTP routes", () => {
	let ctx: Awaited<ReturnType<typeof setupTestPostgresDatabaseWithCollections>>;
	let repo: ContentRepository;
	let admin: { id: string; role: number };

	beforeEach(async () => {
		ctx = await setupTestPostgresDatabaseWithCollections();
		repo = new ContentRepository(ctx.db);
		const registry = new SchemaRegistry(ctx.db);
		await ctx.db
			.insertInto("_emdash_sites")
			.values([
				{ id: "site-foo", slug: "foo", active: 1 },
				{ id: "site-bar", slug: "bar", active: 1 },
			])
			.execute();
		const userRepo = new UserRepository(ctx.db);
		const createdAdmin = await userRepo.create({
			email: "search-admin@example.test",
			role: "admin",
		});
		admin = { id: createdAdmin.id, role: createdAdmin.role };
		await registry.updateField("post", "title", { searchable: true });
		await new FTSManager(ctx.db).enableSearch("post");
		for (const [siteId, entries] of [
			[
				"site-foo",
				[
					["greek-published", "published", "el", "άνθρωπος"],
					["greek-draft", "draft", "el", "άνθρωποι"],
					["other-locale", "published", "en", "άνθρωποι"],
				],
			],
			["site-bar", [["bar-greek", "published", "el", "άνθρωποι"]]],
		] as const) {
			await runWithContext({ editMode: false, siteId }, async () => {
				for (const [slug, status, locale, title] of entries) {
					await repo.create(createPostFixture({ slug, status, locale, data: { title } }));
				}
			});
		}
	}, 30_000);

	afterEach(async () => {
		if (ctx) await teardownTestPostgresDatabase(ctx);
	});

	async function request(
		siteId: string | undefined,
		path: string,
		query = "",
		options: HttpOptions = {},
		clientSiteId?: string,
	) {
		const method = options.method ?? "GET";
		const server = createServer(async (incoming, outgoing) => {
			const url = new URL(incoming.url ?? "/", "http://localhost");
			const incomingHeaders = new Headers();
			for (const [name, value] of Object.entries(incoming.headers)) {
				if (typeof value === "string") incomingHeaders.set(name, value);
			}
			const incomingRequest = new Request(url, {
				method: incoming.method,
				headers: incomingHeaders,
				body: options.body === undefined ? undefined : JSON.stringify(options.body),
			});
			const locals = { emdash: { db: ctx.db }, user: options.user };
			const handler = path.endsWith("/suggest")
				? suggestGet
				: path.endsWith("/stats")
					? statsGet
					: path.endsWith("/rebuild")
						? rebuildPost
						: searchGet;
			try {
				const response = await runWithContext(
					{ editMode: false, ...(siteId ? { siteId } : {}) },
					() => handler({ url, request: incomingRequest, locals } as never),
				);
				outgoing.writeHead(response.status, Object.fromEntries(response.headers));
				outgoing.end(await response.text());
			} catch {
				outgoing.writeHead(500);
				outgoing.end();
			}
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("HTTP test server did not bind");
		const params = new URLSearchParams();
		if (path.endsWith("/search") || path.endsWith("/suggest")) {
			params.set("q", query);
			params.set("collections", "post");
			params.set("locale", options.locale ?? "el");
			if (options.status) params.set("status", options.status);
		}
		if (clientSiteId) params.set("siteId", clientSiteId);
		const suffix = params.size ? `?${params}` : "";
		try {
			const headers = new Headers();
			if (method === "POST") {
				headers.set("content-type", "application/json");
				headers.set("x-emdash-request", "1");
			}
			if (options.spoofSiteHeader) headers.set("x-emdash-site-id", options.spoofSiteHeader);
			return await fetch(`http://127.0.0.1:${address.port}${path}${suffix}`, {
				method,
				headers,
				body: options.body === undefined ? undefined : JSON.stringify(options.body),
			});
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	}

	async function slugs(response: Response): Promise<string[]> {
		const body = await response.json();
		return body.data.items.map((item: { slug: string }) => item.slug);
	}

	it("searches Greek inflections for Foo and Bar without crossing sites or locales", async () => {
		const foo = await request("site-foo", "/_emdash/api/search", "άνθρωποι");
		expect(foo.status).toBe(200);
		expect(await slugs(foo)).toEqual(["greek-published"]);

		const bar = await request("site-bar", "/_emdash/api/search", "άνθρωποι");
		expect(bar.status).toBe(200);
		expect(await slugs(bar)).toEqual(["bar-greek"]);

		const tampered = await request(
			"site-foo",
			"/_emdash/api/search",
			"άνθρωποι",
			{ spoofSiteHeader: "site-bar" },
			"site-bar",
		);
		expect(await slugs(tampered)).toEqual(["greek-published"]);

		const otherLocale = await request("site-foo", "/_emdash/api/search", "άνθρωποι", {
			locale: "en",
		});
		expect(await slugs(otherLocale)).toEqual(["other-locale"]);
	});

	it("matches Greek uppercase and unaccented inflections", async () => {
		for (const term of ["ΆΝΘΡΩΠΟΙ", "ανθρωποι"]) {
			const response = await request("site-foo", "/_emdash/api/search", term);
			expect(response.status).toBe(200);
			expect(await slugs(response)).toEqual(["greek-published"]);
		}
	});

	it("returns published suggestions for only the selected site", async () => {
		const foo = await request("site-foo", "/_emdash/api/search/suggest", "άνθρωπ");
		expect(foo.status).toBe(200);
		expect(await slugs(foo)).toEqual(["greek-published"]);

		const bar = await request("site-bar", "/_emdash/api/search/suggest", "άνθρωπ");
		expect(await slugs(bar)).toEqual(["bar-greek"]);
	});

	it("keeps anonymous search published-only and allows an admin to search drafts", async () => {
		const anonymous = await request("site-foo", "/_emdash/api/search", "άνθρωποι");
		expect(await slugs(anonymous)).toEqual(["greek-published"]);

		const authorized = await request("site-foo", "/_emdash/api/search", "άνθρωποι", {
			user: admin,
			status: "draft",
		});
		expect(authorized.status).toBe(200);
		expect(await slugs(authorized)).toEqual(["greek-draft"]);
	});

	it("updates public results after unpublish, edit, delete, and restore", async () => {
		const content = await ctx.db
			.selectFrom("ec_post")
			.select(["id", "site_id"])
			.where("slug", "=", "greek-published")
			.executeTakeFirstOrThrow();
		const queryFoo = (term: string) => request("site-foo", "/_emdash/api/search", term);

		await ctx.db
			.updateTable("ec_post")
			.set({ status: "draft" })
			.where("id", "=", content.id)
			.execute();
		expect(await slugs(await queryFoo("άνθρωποι"))).toEqual([]);

		await ctx.db
			.updateTable("ec_post")
			.set({ status: "published", title: "άνθρωποι" })
			.where("id", "=", content.id)
			.execute();
		expect(await slugs(await queryFoo("άνθρωπος"))).toEqual(["greek-published"]);

		await ctx.db
			.updateTable("ec_post")
			.set({ deleted_at: new Date().toISOString() })
			.where("id", "=", content.id)
			.execute();
		expect(await slugs(await queryFoo("άνθρωποι"))).toEqual([]);

		await ctx.db
			.updateTable("ec_post")
			.set({ deleted_at: null })
			.where("id", "=", content.id)
			.execute();
		expect(await slugs(await queryFoo("άνθρωποι"))).toEqual(["greek-published"]);

		await ctx.db.deleteFrom("ec_post").where("id", "=", content.id).execute();
		expect(await slugs(await queryFoo("άνθρωποι"))).toEqual([]);
	});

	it("fails closed with an explicit site error for search and suggestions", async () => {
		for (const path of ["/_emdash/api/search", "/_emdash/api/search/suggest"]) {
			const response = await request(undefined, path, "άνθρωπος");
			expect(response.status).toBe(403);
			expect(await response.json()).toMatchObject({
				success: false,
				error: { code: "SITE_REQUIRED" },
			});
		}
	});

	it("requires selected-site context for stats and rebuild, then scopes both to that site", async () => {
		const noSiteStats = await request(undefined, "/_emdash/api/search/stats", "", { user: admin });
		expect(noSiteStats.status).toBe(403);
		expect(await noSiteStats.json()).toMatchObject({ error: { code: "SITE_REQUIRED" } });

		const fooStats = await request("site-foo", "/_emdash/api/search/stats", "", { user: admin });
		expect(fooStats.status).toBe(200);
		const fooBody = await fooStats.json();
		expect(fooBody.data.collections.post.indexed).toBe(3);

		const barStats = await request("site-bar", "/_emdash/api/search/stats", "", { user: admin });
		expect(barStats.status).toBe(200);
		const barBody = await barStats.json();
		expect(barBody.data.collections.post.indexed).toBe(1);

		const noSiteRebuild = await request(undefined, "/_emdash/api/search/rebuild", "", {
			method: "POST",
			body: { collection: "post" },
			user: admin,
		});
		expect(noSiteRebuild.status).toBe(403);
		expect(await noSiteRebuild.json()).toMatchObject({ error: { code: "SITE_REQUIRED" } });

		const fooRebuild = await request("site-foo", "/_emdash/api/search/rebuild", "", {
			method: "POST",
			body: { collection: "post" },
			user: admin,
		});
		expect(fooRebuild.status).toBe(200);
		expect((await fooRebuild.json()).data.indexed).toBe(3);

		const barRebuild = await request("site-bar", "/_emdash/api/search/rebuild", "", {
			method: "POST",
			body: { collection: "post" },
			user: admin,
		});
		expect(barRebuild.status).toBe(200);
		expect((await barRebuild.json()).data.indexed).toBe(1);
	});
});
