import { describe, expect, it } from "vitest";

import {
	getAllTermsForEntries,
	getEntriesByTerm,
	getTaxonomyTerms,
	getTerm,
	getTermsForEntries,
} from "../../../src/taxonomies/index.js";

describe("public taxonomy reads without a selected site", () => {
	it("denies missing terms and empty batches instead of returning an unscoped result", async () => {
		await expect(getTaxonomyTerms("nonexistent")).rejects.toThrow("server-selected site");
		await expect(getTerm("category", "nonexistent")).rejects.toThrow("server-selected site");
		await expect(getTermsForEntries("posts", [], "category")).rejects.toThrow(
			"server-selected site",
		);
		await expect(getAllTermsForEntries("posts", [])).rejects.toThrow("server-selected site");
		await expect(getEntriesByTerm("posts", "category", "nonexistent")).rejects.toThrow(
			"server-selected site",
		);
	});
});
