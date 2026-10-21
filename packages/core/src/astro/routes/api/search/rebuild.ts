/**
 * Search rebuild endpoint - Rebuild FTS index
 *
 * POST /_emdash/api/search/rebuild
 */

import type { APIRoute } from "astro";

import { requirePerm, requireSelectedSite } from "#api/authorize.js";
import { apiError, apiSuccess, handleError } from "#api/error.js";
import { isParseError, parseBody } from "#api/parse.js";
import { searchRebuildBody } from "#api/schemas.js";
import { FTSManager, getSearchStats } from "#search/index.js";

export const prerender = false;

/**
 * Rebuild the search index for a collection
 *
 * Body:
 * - collection: Collection slug to rebuild (required)
 */
export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash, user } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash not configured", 500);
	}

	const denied = requirePerm(user, "search:manage");
	if (denied) return denied;

	const missingSite = requireSelectedSite();
	if (missingSite) return missingSite;

	const body = await parseBody(request, searchRebuildBody);
	if (isParseError(body)) return body;

	const ftsManager = new FTSManager(emdash.db);

	try {
		// Get search config for the collection
		const config = await ftsManager.getSearchConfig(body.collection);
		if (!config?.enabled) {
			return apiError(
				"SEARCH_NOT_ENABLED",
				`Search is not enabled for collection "${body.collection}"`,
				400,
			);
		}

		// Get searchable fields
		const searchableFields = await ftsManager.getSearchableFields(body.collection);
		if (searchableFields.length === 0) {
			return apiError(
				"NO_SEARCHABLE_FIELDS",
				`No searchable fields defined for collection "${body.collection}"`,
				400,
			);
		}

		// Rebuild the index
		await ftsManager.rebuildIndex(
			body.collection,
			searchableFields,
			config.weights,
			config.tokenize,
		);

		const stats = await getSearchStats(emdash.db);

		return apiSuccess({
			collection: body.collection,
			indexed: stats.collections[body.collection]?.indexed ?? 0,
		});
	} catch (error) {
		return handleError(error, "Failed to rebuild index", "REBUILD_ERROR");
	}
};
