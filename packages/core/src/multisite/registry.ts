import type { Kysely } from "kysely";

import type { Database } from "../database/types.js";
import { invalidateSiteSettingsCache } from "../settings/index.js";
import { bumpRunningExportWriteEpochs } from "../transfer/fence.js";
import { isMissingTableError } from "../utils/db-errors.js";

export interface RegisteredSite {
	id: string;
	slug: string;
	status: "active" | "disabled";
	title: string | null;
	domains: string[];
	titleRevision: string | null;
}

export type SiteRegistryResult<T> =
	| { ok: true; value: T }
	| { ok: false; reason: "not_found" | "stale" };

function parseTitle(value: string): string {
	const parsed: unknown = JSON.parse(value);
	if (typeof parsed !== "string") throw new Error("Stored site title is not a string");
	return parsed;
}

export async function listRegisteredSites(db: Kysely<Database>): Promise<RegisteredSite[]> {
	const sites = await db
		.selectFrom("_emdash_sites")
		.select(["id", "slug", "active"])
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
