/**
 * System cleanup
 *
 * Runs periodic maintenance tasks that prevent unbounded accumulation of
 * expired or stale data. Called from cron scheduler ticks and (for latency-
 * sensitive subsystems) inline during relevant requests.
 *
 * Each subsystem cleanup is independent and non-fatal -- if one fails, the
 * rest still run. Failures are logged but never surface to callers.
 */

import { createKyselyAdapter, type AuthTables } from "@emdash-cms/auth/adapters/kysely";
import type { Kysely } from "kysely";

import { cleanupExpiredChallenges } from "./auth/challenge-store.js";
import { MediaRepository } from "./database/repositories/media.js";
import { RedirectRepository } from "./database/repositories/redirect.js";
import { RevisionRepository } from "./database/repositories/revision.js";
import type { Database } from "./database/types.js";
import { removeUploadAttempt } from "./media/upload-attempts.js";
import { cleanupMediaUsage } from "./media/usage/cleanup.js";
import { runWithContext } from "./request-context.js";
import type { Storage } from "./storage/types.js";

/**
 * Result of a system cleanup run.
 * Each field is the number of rows deleted, or -1 if the cleanup failed.
 */
export interface CleanupResult {
	challenges: number;
	expiredTokens: number;
	pendingUploads: number;
	pendingUploadFiles: number;
	uploadAttempts: number;
	revisionsPruned: number;
	mediaUsage: number;
	/** Oldest 404-log rows deleted to restore the hard cap. */
	notFoundLog: number;
	/** Transfer operations whose staging area was collected. */
	transferStaging: number;
}

const REVISION_KEEP_COUNT = 50;
const REVISION_PRUNE_BATCH_SIZE = 10;

/** Target cadence for full system cleanup. */
export const SYSTEM_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Tolerance when comparing the last cleanup time to the interval. Allows
 * a tick that fires slightly before the exact hour to still be treated as
 * the hourly cleanup when the previous one ran at the start of the hour.
 */
const SYSTEM_CLEANUP_INTERVAL_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Decide whether the full system cleanup should run for this tick.
 *
 * Bookkeeping cleanup is expensive on serverless free tiers with tight CPU
 * budgets, so it runs once per hour on the top of the hour. The per-minute
 * path keeps only scheduled publishing, cron tasks, and the heartbeat.
 */
export function shouldRunSystemCleanup(currentTime: Date, lastRunAt?: Date | null): boolean {
	if (currentTime.getUTCMinutes() !== 0) return false;
	if (!lastRunAt) return true;
	return (
		currentTime.getTime() - lastRunAt.getTime() >=
		SYSTEM_CLEANUP_INTERVAL_MS - SYSTEM_CLEANUP_INTERVAL_TOLERANCE_MS
	);
}

/**
 * Run all system cleanup tasks.
 *
 * Safe to call frequently -- each subsystem tolerates repeated calls, and
 * repeated calls with nothing to clean are cheap.
 *
 * @param db - The database instance
 * @param storage - Optional storage backend for deleting orphaned files.
 *   When omitted, pending upload DB rows are still deleted but the
 *   corresponding files in object storage are not removed.
 */
export async function runSystemCleanup(
	db: Kysely<Database>,
	storage?: Storage,
): Promise<CleanupResult> {
	const result: CleanupResult = {
		challenges: -1,
		expiredTokens: -1,
		pendingUploads: -1,
		pendingUploadFiles: -1,
		uploadAttempts: -1,
		revisionsPruned: -1,
		mediaUsage: -1,
		notFoundLog: -1,
		transferStaging: -1,
	};

	// 1. Passkey challenges (expire after 60s, clean anything past 5 min)
	try {
		result.challenges = await cleanupExpiredChallenges(db);
	} catch (error) {
		console.error("[cleanup] Failed to clean expired challenges:", error);
	}

	// 2. Magic link / invite / signup tokens
	try {
		// Cast needed: Database extends AuthTables but uses Generated<> wrappers
		// that confuse structural checks. The adapter casts internally anyway.
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Database uses Generated<> wrappers incompatible with AuthTables structurally; safe at runtime
		const authAdapter = createKyselyAdapter(db as unknown as Kysely<AuthTables>);
		await authAdapter.deleteExpiredTokens();
		result.expiredTokens = 0; // deleteExpiredTokens returns void
	} catch (error) {
		console.error("[cleanup] Failed to clean expired tokens:", error);
	}

	// A scheduler has no request site. Enumerate trusted registry IDs rather than
	// letting the ambient request context select which site's files to remove.
	try {
		const sites = await db.selectFrom("_emdash_sites").select("id").orderBy("id").execute();
		result.pendingUploads = 0;
		result.pendingUploadFiles = 0;
		result.uploadAttempts = 0;
		for (const { id: siteId } of sites) {
			await runWithContext({ editMode: false, siteId }, async () => {
				const mediaRepo = new MediaRepository(db);
				try {
					const orphanedKeys = await mediaRepo.cleanupPendingUploads();
					if (result.pendingUploads !== -1) result.pendingUploads += orphanedKeys.length;
					if (storage) {
						for (const key of orphanedKeys) {
							try {
								await storage.delete(key);
								result.pendingUploadFiles++;
							} catch (error) {
								console.error(`[cleanup] Failed to delete storage file ${key}:`, error);
							}
						}
					}
				} catch (error) {
					result.pendingUploads = -1;
					console.error("[cleanup] Failed to clean pending uploads:", error);
				}
				try {
					const completed = await mediaRepo.deleteCompletedUploadAttempts();
					if (result.uploadAttempts !== -1) result.uploadAttempts += completed;
					if (storage) {
						const storageKeys = await mediaRepo.findUploadAttemptsForCleanup();
						for (const storageKey of storageKeys) {
							if (
								(await removeUploadAttempt(storage, mediaRepo, storageKey)) &&
								result.uploadAttempts !== -1
							)
								result.uploadAttempts++;
						}
					}
				} catch (error) {
					result.uploadAttempts = -1;
					console.error("[cleanup] Failed to clean media upload attempts:", error);
				}
			});
		}
	} catch (error) {
		result.pendingUploads = -1;
		result.pendingUploadFiles = -1;
		result.uploadAttempts = -1;
		console.error("[cleanup] Failed to enumerate media sites:", error);
	}

	try {
		result.revisionsPruned = await pruneQueuedRevisions(db);
	} catch (error) {
		console.error("[cleanup] Failed to prune revisions:", error);
	}

	try {
		const mediaUsage = await cleanupMediaUsage(db);
		result.mediaUsage = mediaUsage.status === "failed" ? -1 : mediaUsage.deletedRows;
	} catch (error) {
		console.error("[cleanup] Failed to clean media usage:", error);
	}

	try {
		result.notFoundLog = await new RedirectRepository(db).cleanup404Log();
	} catch (error) {
		console.error("[cleanup] Failed to cap the 404 log:", error);
	}

	if (storage) {
		try {
			const { collectTransferStaging } = await import("./transfer/gc.js");
			result.transferStaging = (await collectTransferStaging(db, storage)).collected;
		} catch (error) {
			console.error("[transfer] Failed to collect transfer staging:", error);
		}
	} else {
		result.transferStaging = 0;
	}

	return result;
}

async function pruneQueuedRevisions(db: Kysely<Database>): Promise<number> {
	const queued = await db
		.selectFrom("_emdash_revision_prune_queue")
		.selectAll()
		.orderBy("revision_id")
		.limit(REVISION_PRUNE_BATCH_SIZE)
		.execute();
	const revisionRepo = new RevisionRepository(db);
	let totalPruned = 0;

	for (const row of queued) {
		try {
			totalPruned += await revisionRepo.pruneQueuedEntry(
				row.collection,
				row.entry_id,
				row.revision_id,
				REVISION_KEEP_COUNT,
			);
		} catch (error) {
			console.error(
				`[cleanup] Failed to prune revisions for ${row.collection}/${row.entry_id}:`,
				error,
			);
		}
	}

	return totalPruned;
}
