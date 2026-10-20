import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { readinessSource } from "../src/multisite-readiness.js";

function version(files: Record<string, string>): string {
	const hash = createHash("sha256");
	for (const path of Object.keys(files).toSorted()) hash.update(path).update(files[path]!);
	return hash.digest("hex");
}

describe("generated presentation readiness", () => {
	it("keeps missing and unloadable sites unavailable without exposing import errors", async () => {
		const root = mkdtempSync(join(tmpdir(), "emdash-readiness-"));
		try {
			writeFileSync(join(root, "readiness.mjs"), readinessSource);
			mkdirSync(join(root, "missing"), { recursive: true });
			mkdirSync(join(root, "broken/server"), { recursive: true });
			writeFileSync(join(root, "broken/version.json"), JSON.stringify({ version: "0".repeat(64) }));
			writeFileSync(
				join(root, "broken/server/entry.mjs"),
				"throw new Error('private import detail')",
			);
			const { loadPresentations } = await import(pathToFileURL(join(root, "readiness.mjs")).href);
			const { presentations, getPresentationReadiness } = await loadPresentations(root);
			expect(presentations.size).toBe(0);
			expect(getPresentationReadiness("missing")).toMatchObject({ status: "unavailable" });
			expect(getPresentationReadiness("broken")).toMatchObject({ status: "unavailable" });
			expect(JSON.stringify(getPresentationReadiness("broken"))).not.toContain(
				"private import detail",
			);

			const arrivingSource = "export const handler = () => 'not loaded';";
			mkdirSync(join(root, "missing/server"), { recursive: true });
			writeFileSync(join(root, "missing/server/entry.mjs"), arrivingSource);
			const arrivingVersion = version({ "server/entry.mjs": arrivingSource });
			writeFileSync(
				join(root, "missing/version.json"),
				JSON.stringify({ version: arrivingVersion }),
			);
			expect(getPresentationReadiness("missing")).toEqual({
				status: "unavailable",
				loadedVersion: null,
				latestVersion: arrivingVersion,
				pendingRestart: true,
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("reports the current artifact version without replacing the loaded handler", async () => {
		const root = mkdtempSync(join(tmpdir(), "emdash-readiness-"));
		try {
			writeFileSync(join(root, "readiness.mjs"), readinessSource);
			const site = join(root, "foo");
			mkdirSync(join(site, "server"), { recursive: true });
			const entryPath = "server/entry.mjs";
			const entry = join(site, entryPath);
			const loadedSource = "export const handler = () => 'loaded';";
			writeFileSync(entry, loadedSource);
			writeFileSync(join(site, "asset.txt"), "first asset");
			writeFileSync(
				join(site, "version.json"),
				JSON.stringify({
					version: version({ [entryPath]: loadedSource, "asset.txt": "first asset" }),
				}),
			);
			const { loadPresentations } = await import(pathToFileURL(join(root, "readiness.mjs")).href);
			const { presentations, getPresentationReadiness } = await loadPresentations(root);
			const loadedHandler = presentations.get("foo");
			const initial = getPresentationReadiness("foo");
			expect(initial.pendingRestart).toBe(false);

			writeFileSync(join(site, "asset.txt"), "replacement asset");
			const nextVersion = version({ [entryPath]: loadedSource, "asset.txt": "replacement asset" });
			writeFileSync(join(site, "version.json"), JSON.stringify({ version: nextVersion }));
			const changed = getPresentationReadiness("foo");
			expect(changed).toMatchObject({
				status: "ready",
				loadedVersion: initial.loadedVersion,
				latestVersion: nextVersion,
				pendingRestart: true,
			});
			expect(loadedHandler?.()).toBe("loaded");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
