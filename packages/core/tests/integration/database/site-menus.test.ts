import { afterEach, beforeEach, expect, it } from "vitest";

import { up } from "../../../src/database/migrations/099_site_menus.js";
import { MenuRepository } from "../../../src/database/repositories/menu.js";
import { getMenuWithDb, getMenusWithDb } from "../../../src/menus/index.js";
import { runWithContext } from "../../../src/request-context.js";
import {
	describeEachDialect,
	setupForDialectWithCollections,
	teardownForDialect,
	type DialectTestContext,
} from "../../utils/test-db.js";

describeEachDialect("site menus", (dialect) => {
	let ctx: DialectTestContext;
	let menus: MenuRepository;
	const asSite = <T>(siteId: string, fn: () => T): T =>
		runWithContext({ editMode: false, siteId }, fn);

	beforeEach(async () => {
		ctx = await setupForDialectWithCollections(dialect);
		menus = new MenuRepository(ctx.db);
	});

	afterEach(async () => {
		await teardownForDialect(ctx);
	});

	it("keeps same-name navigation separate across public sites", async () => {
		const foo = await asSite("foo", () => menus.create({ name: "primary", label: "Foo nav" }));
		const bar = await asSite("bar", () => menus.create({ name: "primary", label: "Bar nav" }));
		await asSite("foo", () =>
			menus.createItem(foo.id, "en", { type: "custom", label: "Foo link", customUrl: "/foo" }),
		);
		await asSite("bar", () =>
			menus.createItem(bar.id, "en", { type: "custom", label: "Bar link", customUrl: "/bar" }),
		);
		for (const [site, label, url] of [
			["foo", "Foo link", "/foo"],
			["bar", "Bar link", "/bar"],
		] as const) {
			const menu = await asSite(site, () => getMenuWithDb("primary", ctx.db, { locale: "en" }));
			expect(menu?.items.map((item) => [item.label, item.url])).toEqual([[label, url]]);
			expect(await asSite(site, () => getMenusWithDb(ctx.db))).toHaveLength(1);
		}
		expect(await asSite("foo", () => menus.findById(bar.id))).toBeNull();
		expect(await asSite("bar", () => menus.update(foo.id, { label: "stolen" }))).toBeNull();
		expect(await asSite("bar", () => menus.delete(foo.id))).toBe(false);
		expect(await asSite("foo", () => menus.findById(foo.id))).toMatchObject({ label: "Foo nav" });
	});

	it("rejects cross-site parents and missing site context", async () => {
		const foo = await asSite("foo", () => menus.create({ name: "primary", label: "Foo" }));
		const bar = await asSite("bar", () => menus.create({ name: "primary", label: "Bar" }));
		const foreign = await asSite("bar", () =>
			menus.createItem(bar.id, "en", { type: "custom", label: "Bar" }),
		);
		await expect(
			asSite("foo", () =>
				menus.createItem(foo.id, "en", {
					type: "custom",
					label: "Foreign parent",
					parentId: foreign.id,
				}),
			),
		).rejects.toThrow("parent does not belong");
		expect(
			await asSite("foo", () =>
				menus.reorderItems(foo.id, [{ id: foreign.id, parentId: null, sortOrder: 99 }]),
			),
		).toEqual([]);
		expect((await asSite("bar", () => menus.findItems(bar.id)))[0]?.sortOrder).toBe(0);
		await expect(menus.findMany()).rejects.toThrow("server-selected site");
		await expect(menus.create({ name: "primary", label: "No site" })).rejects.toThrow(
			"server-selected site",
		);
	});

	it("rejects foreign content targets and hides foreign item URLs", async () => {
		const foo = await asSite("foo", () => menus.create({ name: "primary", label: "Foo" }));
		await ctx.db.insertInto("_emdash_sites").values({ id: "bar", slug: "bar" }).execute();
		await ctx.db
			.insertInto("ec_page" as never)
			.values({
				id: "bar-page",
				site_id: "bar",
				slug: "bar-page",
				locale: "en",
				translation_group: "bar-group",
				status: "published",
			} as never)
			.execute();
		await expect(
			asSite("foo", () =>
				menus.createItem(foo.id, "en", {
					type: "page",
					referenceCollection: "page",
					referenceId: "bar-group",
					label: "Bar page",
				}),
			),
		).rejects.toThrow("does not belong to the selected site");
		await ctx.db
			.insertInto("_emdash_menu_items")
			.values({
				id: "foreign-reference",
				site_id: "foo",
				menu_id: foo.id,
				sort_order: 0,
				type: "page",
				reference_collection: "page",
				reference_id: "bar-group",
				label: "Bar page",
			})
			.execute();
		const menu = await asSite("foo", () => getMenuWithDb("primary", ctx.db, { locale: "en" }));
		expect(menu?.items.some((item) => item.url?.includes("bar-page"))).toBe(false);
	});

	it("retains site ownership and uniqueness on migration retry", async () => {
		const foo = await asSite("foo", () => menus.create({ name: "primary", label: "Foo" }));
		await up(ctx.db);
		expect(await asSite("foo", () => menus.findById(foo.id))).not.toBeNull();
		await expect(
			asSite("foo", () => menus.create({ name: "primary", label: "Again" })),
		).rejects.toThrow();
		await asSite("bar", () => menus.create({ name: "primary", label: "Bar" }));
	});
});
