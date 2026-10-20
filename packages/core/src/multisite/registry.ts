import { sql, type Kysely } from "kysely";
import { ulid } from "ulidx";

import type { Database } from "../database/types.js";
import { runWithContext } from "../request-context.js";
import { applySeed } from "../seed/apply.js";
import type { SeedFile } from "../seed/types.js";
import { invalidateSiteSettingsCache } from "../settings/index.js";
import type { Storage } from "../storage/types.js";
import { bumpRunningExportWriteEpochs } from "../transfer/fence.js";
import { isMissingTableError } from "../utils/db-errors.js";

export interface RegisteredSite {
	id: string;
	slug: string;
	status: "active" | "disabled";
	title: string | null;
	domains: string[];
	titleRevision: string | null;
	presentation: string;
}

export type SiteRegistryResult<T> =
	| { ok: true; value: T }
	| { ok: false; reason: "not_found" | "stale" };

const SITE_SLUG_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
const SITE_REQUEST_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;

async function createPayloadHash(payload: {
	title: string;
	slug: string;
	hostname: string;
}): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(JSON.stringify(payload)),
	);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseTitle(value: string): string {
	const parsed: unknown = JSON.parse(value);
	if (typeof parsed !== "string") throw new Error("Stored site title is not a string");
	return parsed;
}

export async function listRegisteredSites(db: Kysely<Database>): Promise<RegisteredSite[]> {
	const sites = await db
		.selectFrom("_emdash_sites")
		.select(["id", "slug", "active", "presentation"])
		.orderBy("slug")
		.execute();
	const hosts = await db
		.selectFrom("_emdash_site_hosts")
		.select(["hostname", "site_id"])
		.orderBy("hostname")
		.execute();
	const options = await db
		.selectFrom("options")
		.select(["name", "value", "revision", "site_id"])
		.where("name", "like", "site:%:title")
		.execute();
	return sites.map((site) => {
		const name = `site:${site.id}:title`;
		const title = options.find((option) => option.name === name && option.site_id === site.id);
		return {
			id: site.id,
			slug: site.slug,
			presentation: site.presentation ?? "",
			status: site.active ? "active" : "disabled",
			title: title ? parseTitle(title.value) : null,
			titleRevision: title?.revision ?? null,
			domains: hosts.filter((host) => host.site_id === site.id).map((host) => host.hostname),
		};
	});
}

export async function getRegisteredSite(
	db: Kysely<Database>,
	id: string,
): Promise<RegisteredSite | null> {
	return (await listRegisteredSites(db)).find((site) => site.id === id) ?? null;
}

export async function createRegisteredSite(
	db: Kysely<Database>,
	input: {
		title: string;
		slug: string;
		hostname: string;
		siteUrl: string;
		actorId: string | null;
		actorScope: string;
		actorSource: "system-admin" | "cli";
		requestKey: string;
		seed: SeedFile;
		storage: Storage;
	},
): Promise<RegisteredSite> {
	if (
		!input.title.trim() ||
		input.title.length > 120 ||
		!SITE_SLUG_PATTERN.test(input.slug) ||
		!SITE_REQUEST_KEY_PATTERN.test(input.requestKey)
	) {
		throw new Error("Invalid site title, slug, or idempotency key");
	}
	const payloadHash = await createPayloadHash({
		title: input.title,
		slug: input.slug,
		hostname: input.hostname,
	});
	return db.transaction().execute(async (trx) => {
		await sql`SELECT pg_advisory_xact_lock(hashtext(${input.actorScope + ":" + input.requestKey}))`.execute(
			trx,
		);
		const prior = await trx
			.selectFrom("_emdash_site_creation_requests")
			.select(["payload_hash", "site_id"])
			.where("actor_scope", "=", input.actorScope)
			.where("request_key", "=", input.requestKey)
			.executeTakeFirst();
		if (prior) {
			if (prior.payload_hash !== payloadHash)
				throw new Error("Idempotency key was already used for a different site request");
			const site = await getRegisteredSite(trx, prior.site_id);
			if (!site) throw new Error("Site creation request points to a missing site");
			return site;
		}
		await sql`SELECT pg_advisory_xact_lock(hashtext(${input.slug}))`.execute(trx);
		const current = await trx
			.selectFrom("_emdash_sites")
			.select(["id", "presentation"])
			.where("slug", "=", input.slug)
			.executeTakeFirst();
		if (current) throw new Error("Site slug is already registered");
		const hostConflict = await trx
			.selectFrom("_emdash_site_hosts")
			.select("hostname")
			.where("hostname", "=", input.hostname)
			.executeTakeFirst();
		if (hostConflict) throw new Error("Site hostname is already registered");
		for (const collection of input.seed.collections ?? []) {
			const fields = await sql<{
				slug: string;
				field: string | null;
			}>`SELECT c.slug, f.slug AS field FROM _emdash_collections c LEFT JOIN _emdash_fields f ON f.collection_id = c.id WHERE c.slug = ${collection.slug}`.execute(
				trx,
			);
			if (
				!fields.rows.length ||
				collection.fields.some((field) => !fields.rows.some((row) => row.field === field.slug))
			) {
				throw new Error(`Shared collection "${collection.slug}" is missing starter fields`);
			}
		}
		for (const taxonomy of input.seed.taxonomies ?? []) {
			const definition = await trx
				.selectFrom("_emdash_taxonomy_defs")
				.select("name")
				.where("name", "=", taxonomy.name)
				.executeTakeFirst();
			if (!definition) throw new Error(`Shared taxonomy "${taxonomy.name}" is missing`);
		}
		const siteId = `site-${ulid()}`;
		await trx
			.insertInto("_emdash_sites")
			.values({ id: siteId, slug: input.slug, active: 1, presentation: "default" })
			.execute();
		await trx
			.insertInto("_emdash_site_hosts")
			.values({ hostname: input.hostname, site_id: siteId })
			.execute();
		const seed: SeedFile = {
			version: input.seed.version,
			...(input.seed.defaultLocale ? { defaultLocale: input.seed.defaultLocale } : {}),
			settings: { ...input.seed.settings, title: input.title, url: input.siteUrl },
			bylines: input.seed.bylines,
			content: input.seed.content,
			menus: input.seed.menus,
		};
		for (const taxonomy of input.seed.taxonomies ?? []) {
			for (const term of taxonomy.terms ?? []) {
				const id = ulid();
				await trx
					.insertInto("taxonomies")
					.values({
						id,
						name: taxonomy.name,
						slug: term.slug,
						label: term.label,
						locale: "en",
						translation_group: id,
						site_id: siteId,
						parent_id: null,
						data: null,
					})
					.execute();
			}
		}
		await runWithContext({ editMode: false, siteId }, () =>
			applySeed(trx, seed, {
				includeContent: true,
				storage: input.storage,
				failOnMediaError: true,
				onConflict: "error",
			}),
		);
		await trx
			.insertInto("_emdash_site_creation_requests")
			.values({
				actor_scope: input.actorScope,
				actor_id: input.actorId,
				request_key: input.requestKey,
				payload_hash: payloadHash,
				site_id: siteId,
				created_at: new Date().toISOString(),
			})
			.execute();
		await trx
			.insertInto("audit_logs")
			.values({
				id: crypto.randomUUID(),
				actor_id: input.actorId,
				actor_ip: null,
				action: "site_create",
				resource_type: "site",
				resource_id: siteId,
				details: JSON.stringify({ slug: input.slug, source: input.actorSource }),
				status: "success",
			})
			.execute();
		const site = await getRegisteredSite(trx, siteId);
		if (!site) throw new Error("Created site could not be read");
		return site;
	});
}

export async function updateRegisteredSiteTitle(
	db: Kysely<Database>,
	input: {
		siteId: string;
		title: string;
		expectedRevision: string | null;
		actorId: string;
	},
): Promise<SiteRegistryResult<RegisteredSite>> {
	const result = await db.transaction().execute(async (trx) => {
		const site = await trx
			.selectFrom("_emdash_sites")
			.select("id")
			.where("id", "=", input.siteId)
			.executeTakeFirst();
		if (!site) return { ok: false, reason: "not_found" } as const;
		const current = await trx
			.selectFrom("options")
			.select(["revision", "site_id"])
			.where("name", "=", `site:${input.siteId}:title`)
			.executeTakeFirst();
		if (current && current.site_id !== input.siteId) return { ok: false, reason: "stale" } as const;
		if ((current?.revision ?? null) !== input.expectedRevision) {
			return { ok: false, reason: "stale" } as const;
		}
		const revision = crypto.randomUUID();
		const write = await trx
			.insertInto("options")
			.values({
				name: `site:${input.siteId}:title`,
				value: JSON.stringify(input.title),
				site_id: input.siteId,
				revision,
			})
			.onConflict((conflict) =>
				conflict
					.column("name")
					.doUpdateSet({ value: JSON.stringify(input.title), revision })
					.where("options.revision", "=", input.expectedRevision ?? ""),
			)
			.executeTakeFirst();
		if ((write.numInsertedOrUpdatedRows ?? 0n) === 0n)
			return { ok: false, reason: "stale" } as const;
		try {
			await bumpRunningExportWriteEpochs(trx);
		} catch (error) {
			if (!isMissingTableError(error)) throw error;
		}
		await trx
			.insertInto("audit_logs")
			.values({
				id: crypto.randomUUID(),
				actor_id: input.actorId,
				actor_ip: null,
				action: "settings_update",
				resource_type: "site",
				resource_id: input.siteId,
				details: JSON.stringify({ field: "title" }),
				status: "success",
			})
			.execute();
		return { ok: true, value: (await getRegisteredSite(trx, input.siteId))! } as const;
	});
	if (result.ok) invalidateSiteSettingsCache(input.siteId);
	return result;
}
