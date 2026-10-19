import { sql, type Kysely } from "kysely";

import { runMigrations } from "../database/migrations/runner.js";
import {
	acquirePostgresMigrationLock,
	MIGRATION_LOCK_BUSY_MESSAGE,
} from "../database/pg-migration-lock.js";
import { OptionsRepository } from "../database/repositories/options.js";
import type { Database } from "../database/types.js";
import { applySeed } from "../seed/apply.js";
import { claimExplicitSeedOwnership } from "../seed/ownership.js";
import type { SeedFile } from "../seed/types.js";

const SETUP_COMPLETE_OPTION = "emdash:setup_complete";

export interface MultisiteInitializationResult {
	fresh: boolean;
	migrationsApplied: string[];
}

export async function initializeMultisiteDatabase(
	db: Kysely<Database>,
	seed: SeedFile,
): Promise<MultisiteInitializationResult> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await db.transaction().execute(async (trx) => {
				await acquirePostgresMigrationLock(trx);
				const fresh = await isFreshPostgresDatabase(trx);
				const { applied } = await runMigrations(trx, { skipFastPath: true });
				if (!fresh) return { fresh: false, migrationsApplied: applied };

				const compatibilitySite = await sql<{ id: string }>`
					SELECT id FROM _emdash_sites WHERE id = 'site-default'
				`.execute(trx);
				if (compatibilitySite.rows.length !== 1) {
					throw new Error("Fresh multisite initialization did not create the compatibility site");
				}
				await sql`DELETE FROM _emdash_sites WHERE id = 'site-default'`.execute(trx);

				const sharedSeed: SeedFile = {
					version: seed.version,
					...(seed.defaultLocale ? { defaultLocale: seed.defaultLocale } : {}),
					...(seed.blockTypes ? { blockTypes: seed.blockTypes } : {}),
					...(seed.relations ? { relations: seed.relations } : {}),
					...(seed.collections ? { collections: seed.collections } : {}),
					...(seed.taxonomies
						? { taxonomies: seed.taxonomies.map(({ terms: _terms, ...taxonomy }) => taxonomy) }
						: {}),
				};
				await applySeed(trx, sharedSeed, { onConflict: "skip" });
				await claimExplicitSeedOwnership(trx, sharedSeed);
				await new OptionsRepository(trx).set(SETUP_COMPLETE_OPTION, true);
				return { fresh: true, migrationsApplied: applied };
			});
		} catch (error) {
			if (
				!(error instanceof Error && error.message.includes(MIGRATION_LOCK_BUSY_MESSAGE)) ||
				attempt >= 300
			) {
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
}

async function isFreshPostgresDatabase(db: Kysely<Database>): Promise<boolean> {
	const result = await sql<{
		migrationTable: string | null;
		optionsTable: string | null;
		sitesTable: string | null;
		collectionsTable: string | null;
		applicationTables: boolean;
	}>`
		SELECT
			to_regclass(format('%I.%I', current_schema(), '_emdash_migrations'))::text AS "migrationTable",
			to_regclass(format('%I.%I', current_schema(), 'options'))::text AS "optionsTable",
			to_regclass(format('%I.%I', current_schema(), '_emdash_sites'))::text AS "sitesTable",
			to_regclass(format('%I.%I', current_schema(), '_emdash_collections'))::text AS "collectionsTable",
			EXISTS (
				SELECT 1 FROM pg_class c
				JOIN pg_namespace n ON n.oid = c.relnamespace
				WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p')
				AND (c.relname LIKE '\\_emdash\\_%' ESCAPE '\\' OR c.relname LIKE 'ec\\_%' ESCAPE '\\'
					OR c.relname IN ('media', 'taxonomies', 'content_taxonomies'))
			) AS "applicationTables"
	`.execute(db);
	const state = result.rows[0];
	if (!state)
		throw new Error("Could not inspect the PostgreSQL schema before multisite initialization");
	const hasMigrationTable = state.migrationTable !== null;
	const hasCoreTables = [state.optionsTable, state.sitesTable, state.collectionsTable].every(
		(table) => table !== null,
	);
	if (!hasMigrationTable && !state.applicationTables) return true;
	if (hasMigrationTable && hasCoreTables) return false;
	throw new Error(
		"Cannot initialize multisite hosting because the PostgreSQL schema is partial or unknown",
	);
}
