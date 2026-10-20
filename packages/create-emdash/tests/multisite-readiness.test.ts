import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { readinessSource } from "../src/multisite-readiness.js";

async function loadArtifactModule(root: string) {
	writeFileSync(join(root, "readiness.mjs"), readinessSource);
	return import(pathToFileURL(join(root, "readiness.mjs")).href);
}

describe("generated presentation readiness", () => {
	it("keeps missing and unloadable sites unavailable without exposing import errors", async () => {
		const root = mkdtempSync(join(tmpdir(), "emdash-readiness-"));
		try {
			const { loadPresentations, artifactVersion } = await loadArtifactModule(root);
			mkdirSync(join(root, "missing"), { recursive: true });
			mkdirSync(join(root, "broken/server"), { recursive: true });
			writeFileSync(
				join(root, "broken/server/entry.mjs"),
				"throw new Error('private import detail')",
			);
			writeFileSync(
				join(root, "broken/version.json"),
				JSON.stringify({ version: artifactVersion(join(root, "broken")) }),
			);
			mkdirSync(join(root, "valid/server"), { recursive: true });
			writeFileSync(join(root, "valid/server/entry.mjs"), "export const handler = () => 'valid';");
			writeFileSync(
				join(root, "valid/version.json"),
				JSON.stringify({ version: artifactVersion(join(root, "valid")) }),
			);
			writeFileSync(
				join(root, "missing/version.json"),
				JSON.stringify({ version: artifactVersion(join(root, "missing")) }),
			);
			const { presentations, getPresentationReadiness } = await loadPresentations(root);
			expect(presentations.size).toBe(1);
			expect(presentations.get("valid")?.()).toBe("valid");
			expect(getPresentationReadiness("missing")).toEqual({
				status: "unavailable",
				loadedVersion: null,
				latestVersion: null,
				pendingRestart: false,
			});
			expect(getPresentationReadiness("broken")).toMatchObject({
				status: "unavailable",
				loadedVersion: null,
				pendingRestart: false,
			});
			expect(JSON.stringify(getPresentationReadiness("broken"))).not.toContain(
				"private import detail",
			);

			writeFileSync(
				join(root, "broken/server/entry.mjs"),
				"export const handler = () => 'replacement';",
			);
			const replacementVersion = artifactVersion(join(root, "broken"));
			writeFileSync(
				join(root, "broken/version.json"),
				JSON.stringify({ version: replacementVersion }),
			);
			expect(getPresentationReadiness("broken")).toMatchObject({
				status: "unavailable",
				loadedVersion: null,
				latestVersion: replacementVersion,
				pendingRestart: true,
			});

			const arrivingSource = "export const handler = () => 'not loaded';";
			mkdirSync(join(root, "missing/server"), { recursive: true });
			writeFileSync(join(root, "missing/server/entry.mjs"), arrivingSource);
			const arrivingVersion = artifactVersion(join(root, "missing"));
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
			const { loadPresentations, artifactVersion } = await loadArtifactModule(root);
			const site = join(root, "foo");
			mkdirSync(join(site, "server"), { recursive: true });
			const entryPath = "server/entry.mjs";
			const entry = join(site, entryPath);
			const loadedSource = "export const handler = () => 'loaded';";
			writeFileSync(entry, loadedSource);
			writeFileSync(join(site, "asset.txt"), "first asset");
			writeFileSync(join(site, "version.json"), JSON.stringify({ version: artifactVersion(site) }));
			const { presentations, getPresentationReadiness } = await loadPresentations(root);
			const loadedHandler = presentations.get("foo");
			const initial = getPresentationReadiness("foo");
			expect(initial.pendingRestart).toBe(false);

			writeFileSync(join(site, "asset.txt"), "replacement asset");
			const nextVersion = artifactVersion(site);
			writeFileSync(join(site, "version.json"), JSON.stringify({ version: nextVersion }));
			const changed = getPresentationReadiness("foo");
			expect(changed).toMatchObject({
				status: "ready",
				loadedVersion: initial.loadedVersion,
				latestVersion: nextVersion,
				pendingRestart: true,
			});
			expect(loadedHandler?.()).toBe("loaded");

			rmSync(entry);
			const missingEntry = getPresentationReadiness("foo");
			expect(missingEntry).toMatchObject({
				status: "unavailable",
				loadedVersion: initial.loadedVersion,
				latestVersion: null,
				pendingRestart: false,
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
