import { Role } from "@emdash-cms/auth";
import type { APIContext } from "astro";
import { afterEach, beforeEach, expect, it } from "vitest";

import { handleContentGet } from "../../../src/api/handlers/content.js";
import {
	handleTaxonomyCreate,
	handleTermTranslations,
} from "../../../src/api/handlers/taxonomies.js";
import {
	GET as getAssignments,
	POST as setAssignments,
} from "../../../src/astro/routes/api/content/[collection]/[id]/terms/[taxonomy].js";
import { POST as reorderTerms } from "../../../src/astro/routes/api/taxonomies/[name]/reorder.js";
import { GET as getTranslations } from "../../../src/astro/routes/api/taxonomies/[name]/terms/[slug]/translations.js";
import { GET as listTerms } from "../../../src/astro/routes/api/taxonomies/[name]/terms/index.js";
import { ContentRepository } from "../../../src/database/repositories/content.js";
import { TaxonomyRepository } from "../../../src/database/repositories/taxonomy.js";
import { runWithContext } from "../../../src/request-context.js";
import {
	describeEachDialect,
	setupForDialectWithCollections,
	teardownForDialect,
	type DialectTestContext,
} from "../../utils/test-db.js";

const site = <T>(siteId: string, fn: () => T): T => runWithContext({ editMode: false, siteId }, fn);

function context(db: DialectTestContext["db"], method: string, path: string, body?: unknown) {
	return {
		params: path.startsWith("content/")
			? { collection: "post", id: path.split("/")[1], taxonomy: "tags" }
			: { name: "tags", slug: "news" },
		request: new Request(`http://localhost/${path}`, {
			method,
			...(body !== undefined && {
				body: JSON.stringify(body),
				headers: { "content-type": "application/json" },
			}),
		}),
		locals: {
			emdash: {
				db,
				handleContentGet: (collection: string, id: string) => handleContentGet(db, collection, id),
			},
			user: { id: "author", role: Role.ADMIN },
		},
	} as unknown as APIContext;
}

describeEachDialect("site-scoped taxonomy admin HTTP", (dialect) => {
	let ctx: DialectTestContext;
	beforeEach(async () => {
		ctx = await setupForDialectWithCollections(dialect);
		await ctx.db.insertInto("_emdash_sites").values({ id: "site-bar", slug: "bar" }).execute();
		await site("site-default", () =>
			handleTaxonomyCreate(ctx.db, { name: "tags", label: "Tags", collections: ["post"] }),
		);
	});
	afterEach(async () => teardownForDialect(ctx));

	it("isolates translations and rejects foreign entry and term IDs at the HTTP boundary", async () => {
		const fooTerm = await new TaxonomyRepository(ctx.db, "site-default").create({
			name: "tags",
			slug: "news",
			label: "Foo",
		});
		const barTerm = await new TaxonomyRepository(ctx.db, "site-bar").create({
			name: "tags",
			slug: "news",
			label: "Bar",
		});
		const fooEntry = await site("site-default", () =>
			new ContentRepository(ctx.db).create({ type: "post", slug: "foo", data: { title: "Foo" } }),
		);
		const barEntry = await site("site-bar", () =>
			new ContentRepository(ctx.db).create({ type: "post", slug: "bar", data: { title: "Bar" } }),
		);
		const translations = await site("site-default", () =>
			getTranslations(context(ctx.db, "GET", "taxonomies/tags/terms/news/translations")),
		);
		expect(translations.status).toBe(200);
		expect(
			await site("site-default", () => handleTermTranslations(ctx.db, barTerm.id)),
		).toMatchObject({
			success: false,
			error: { code: "NOT_FOUND" },
		});
		expect(
			(await translations.json()).data.translations.map((term: { id: string }) => term.id),
		).toEqual([fooTerm.id]);

		const foreignTerm = await site("site-default", () =>
			setAssignments(
				context(ctx.db, "POST", `content/${fooEntry.id}/terms/tags`, { termIds: [barTerm.id] }),
			),
		);
		expect(foreignTerm.status).toBe(404);
		const foreignEntry = await site("site-default", () =>
			setAssignments(
				context(ctx.db, "POST", `content/${barEntry.id}/terms/tags`, { termIds: [fooTerm.id] }),
			),
		);
		expect(foreignEntry.status).toBe(404);
		const foreignRead = await site("site-default", () =>
			getAssignments(context(ctx.db, "GET", `content/${barEntry.id}/terms/tags`)),
		);
		expect(foreignRead.status).toBe(404);
		const foreignParent = await site("site-default", () =>
			reorderTerms(
				context(ctx.db, "POST", "taxonomies/tags/reorder", { parentId: barTerm.id, ids: [] }),
			),
		);
		expect(foreignParent.status).toBe(404);
		const ownAssignment = await site("site-default", () =>
			setAssignments(
				context(ctx.db, "POST", `content/${fooEntry.id}/terms/tags`, { termIds: [fooTerm.id] }),
			),
		);
		expect(ownAssignment.status).toBe(200);
		expect(
			await new TaxonomyRepository(ctx.db, "site-bar").getTermsForEntry(
				"post",
				barEntry.id,
				"tags",
				"en",
			),
		).toEqual([]);
	});

	it("denies term and assignment routes without a selected site", async () => {
		const termList = await listTerms(context(ctx.db, "GET", "taxonomies/tags/terms"));
		expect(termList.status).toBe(403);
		const assignment = await setAssignments(
			context(ctx.db, "POST", "content/unknown/terms/tags", { termIds: [] }),
		);
		expect(assignment.status).toBe(403);
	});
});
