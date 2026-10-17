import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { APIContext } from "astro";
import { sql } from "kysely";
import { afterEach, expect, it } from "vitest";

import {
	handleMediaCreate,
	handleMediaDelete,
	handleMediaGet,
	handleMediaReplaceMetadata,
} from "../../../src/api/handlers/media.js";
import { POST as uploadMedia } from "../../../src/astro/routes/api/media.js";
import {
	GET as getMedia,
	DELETE as deleteMedia,
} from "../../../src/astro/routes/api/media/[id].js";
import { PUT as replaceMedia } from "../../../src/astro/routes/api/media/[id]/replace.js";
import { GET as getAsset } from "../../../src/astro/routes/api/media/asset/[id]/[filename].js";
import { GET as getFile } from "../../../src/astro/routes/api/media/file/[...key].js";
import { POST as uploadUrl } from "../../../src/astro/routes/api/media/upload-url.js";
import { MediaRepository } from "../../../src/database/repositories/media.js";
import { isReadyMediaKey, matchInternalMediaKey } from "../../../src/media/image-endpoint.js";
import { runWithContext } from "../../../src/request-context.js";
import { LocalStorage } from "../../../src/storage/local.js";
import {
	describeEachDialect,
	setupForDialect,
	teardownForDialect,
	type DialectName,
} from "../../utils/test-db.js";

const actor = { id: "editor", role: 40, email: "editor@example.test", name: "Editor" };
const first = new Uint8Array([1, 2, 3]);
const second = new Uint8Array([4, 5, 6]);

describeEachDialect("site media HTTP and local storage", (dialect: DialectName) => {
	let db: Awaited<ReturnType<typeof setupForDialect>>;
	let directory: string;
	let storage: LocalStorage;

	afterEach(async () => {
		if (db) await teardownForDialect(db);
		if (directory) await rm(directory, { recursive: true, force: true });
	});

	it("binds upload, signed fallback, file, asset, replace and delete to the resolved site", async () => {
		db = await setupForDialect(dialect);
		await sql`INSERT INTO _emdash_sites (id, slug) VALUES ('site-foo', 'foo')`.execute(db.db);
		directory = await mkdtemp(join(tmpdir(), "emdash-site-media-"));
		storage = new LocalStorage({ directory, baseUrl: "http://media.example.test" });
		const emdash = {
			db: db.db,
			storage,
			config: {},
			handleMediaCreate: (input: Parameters<typeof handleMediaCreate>[1]) =>
				handleMediaCreate(db.db, input),
			handleMediaGet: (id: string) => handleMediaGet(db.db, id),
			handleMediaDelete: (id: string) => handleMediaDelete(db.db, id, storage),
			handleMediaReplaceMetadata: (
				id: string,
				key: string,
				input: Parameters<typeof handleMediaReplaceMetadata>[3],
			) => handleMediaReplaceMetadata(db.db, id, key, input),
		};
		const visit = <T>(siteId: string | undefined, fn: () => Promise<T>) =>
			runWithContext({ editMode: false, siteId }, fn);
		const call = (
			route: (ctx: APIContext) => Response | Promise<Response>,
			host: string,
			method: string,
			path: string,
			params: Record<string, string>,
			body?: BodyInit,
		) => {
			const request = new Request(`http://${host}/_emdash/api/media/${path}`, {
				method,
				body,
				headers: method === "GET" ? undefined : { "X-EmDash-Request": "1" },
			});
			return route({
				request,
				params,
				locals: { emdash, user: actor },
				url: new URL(request.url),
			} as unknown as APIContext);
		};
		const form = (bytes: Uint8Array) => {
			const data = new FormData();
			data.set("file", new File([bytes], "same.png", { type: "image/png" }));
			return data;
		};
		const uploaded = await visit("site-foo", async () => {
			const response = await call(uploadMedia, "foo.test", "POST", "", {}, form(first));
			expect(response.status).toBe(201);
			return ((await response.json()) as { data: { item: { id: string; storageKey: string } } })
				.data.item;
		});
		expect(uploaded.storageKey).toMatch(/^sites\/site-foo\/media\//);
		const defaultItem = await visit("site-default", async () => {
			const response = await call(uploadMedia, "default.test", "POST", "", {}, form(first));
			expect(response.status).toBe(201);
			return ((await response.json()) as { data: { item: { id: string; storageKey: string } } })
				.data.item;
		});
		expect(defaultItem.id).not.toBe(uploaded.id);
		expect(defaultItem.storageKey).toMatch(/^sites\/site-default\/media\//);
		expect(
			matchInternalMediaKey(`http://foo.test/_emdash/api/media/file/${uploaded.storageKey}`),
		).toBe(uploaded.storageKey);
		expect(await visit("site-foo", () => isReadyMediaKey(db.db, defaultItem.storageKey))).toBe(
			false,
		);
		expect(await visit("site-foo", () => isReadyMediaKey(db.db, uploaded.storageKey))).toBe(true);
		const file = (key: string, host = "foo.test") =>
			call(getFile, host, "GET", `file/${key}`, { key });
		expect(await (await visit("site-foo", () => file(uploaded.storageKey))).arrayBuffer()).toEqual(
			first.buffer,
		);
		expect((await visit("site-foo", () => file(defaultItem.storageKey))).status).toBe(404);
		expect(
			(await visit("site-default", () => file(uploaded.storageKey, "default.test"))).status,
		).toBe(404);
		expect((await visit("site-foo", () => file("sites/site-foo/media/guessed.png"))).status).toBe(
			404,
		);
		expect(
			(
				await visit("site-foo", () =>
					call(getMedia, "foo.test", "GET", defaultItem.id, { id: defaultItem.id }),
				)
			).status,
		).toBe(404);
		expect(
			(
				await visit("site-foo", () =>
					call(getAsset, "foo.test", "GET", `asset/${defaultItem.id}/same.png`, {
						id: defaultItem.id,
						filename: "same.png",
					}),
				)
			).status,
		).toBe(404);
		expect(
			(
				await visit("site-foo", () =>
					call(deleteMedia, "foo.test", "DELETE", defaultItem.id, { id: defaultItem.id }),
				)
			).status,
		).toBe(404);
		const replacement = form(second);
		replacement.set("width", "1");
		replacement.set("height", "1");
		expect(
			(
				await visit("site-foo", () =>
					call(
						replaceMedia,
						"foo.test",
						"PUT",
						`${defaultItem.id}/replace`,
						{ id: defaultItem.id },
						replacement,
					),
				)
			).status,
		).toBe(404);
		expect(await storage.exists(defaultItem.storageKey)).toBe(true);
		const ownReplacement = form(second);
		ownReplacement.set("width", "1");
		ownReplacement.set("height", "1");
		expect(
			(
				await visit("site-foo", () =>
					call(
						replaceMedia,
						"foo.test",
						"PUT",
						`${uploaded.id}/replace`,
						{ id: uploaded.id },
						ownReplacement,
					),
				)
			).status,
		).toBe(200);
		expect(
			new Uint8Array(
				await (await visit("site-foo", () => file(uploaded.storageKey))).arrayBuffer(),
			),
		).toEqual(second);
		expect(
			new Uint8Array(
				await (
					await visit("site-default", () => file(defaultItem.storageKey, "default.test"))
				).arrayBuffer(),
			),
		).toEqual(first);
		const signed = await visit("site-foo", () =>
			call(
				uploadUrl,
				"foo.test",
				"POST",
				"upload-url",
				{},
				JSON.stringify({ filename: "pending.png", contentType: "image/png", size: 3 }),
			),
		);
		expect(signed.status).toBe(200);
		const pending = ((await signed.json()) as { data: { storageKey: string } }).data;
		expect(pending.storageKey).toMatch(/^sites\/site-foo\/media\//);
		expect((await visit("site-foo", () => file(pending.storageKey))).status).toBe(404);
		const legacy = await visit("site-default", () =>
			new MediaRepository(db.db).create({
				filename: "legacy.png",
				mimeType: "image/png",
				storageKey: "legacy.png",
			}),
		);
		await storage.upload({ key: legacy.storageKey, body: first, contentType: "image/png" });
		expect(
			(await visit("site-default", () => file(legacy.storageKey, "default.test"))).status,
		).toBe(200);
		expect((await visit("site-foo", () => file(legacy.storageKey))).status).toBe(404);
		expect(
			(
				await visit("site-foo", () =>
					call(deleteMedia, "foo.test", "DELETE", uploaded.id, { id: uploaded.id }),
				)
			).status,
		).toBe(200);
		expect(await storage.exists(uploaded.storageKey)).toBe(false);
		expect(await storage.exists(defaultItem.storageKey)).toBe(true);
		expect((await visit(undefined, () => file(defaultItem.storageKey))).status).not.toBe(200);
	});
});
