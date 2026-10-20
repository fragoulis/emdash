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

	it("keeps lazy imports in the loaded generation after a new build is published", async () => {
		const root = mkdtempSync(join(tmpdir(), "emdash-readiness-"));
		try {
			const { loadPresentations, artifactVersion } = await loadArtifactModule(root);
			const site = join(root, "foo");
			const oldId = "11111111-1111-4111-8111-111111111111";
			const newId = "22222222-2222-4222-8222-222222222222";
			const oldGeneration = join(site, "generations", oldId);
			const newGeneration = join(site, "generations", newId);
			mkdirSync(join(oldGeneration, "server/chunks"), { recursive: true });
			writeFileSync(
				join(oldGeneration, "server/chunks/lazy.mjs"),
				"export const value = 'old asset';",
			);
			writeFileSync(
				join(oldGeneration, "server/entry.mjs"),
				"export async function handler() { return (await import('./chunks/lazy.mjs')).value; }",
			);
			const firstVersion = artifactVersion(oldGeneration);
			writeFileSync(
				join(site, "version.json"),
				JSON.stringify({ version: firstVersion, generation: oldId }),
			);
			const { presentations, getPresentationReadiness } = await loadPresentations(root);
			const oldHandler = presentations.get("foo");
			expect(getPresentationReadiness("foo").pendingRestart).toBe(false);

			mkdirSync(join(newGeneration, "server/chunks"), { recursive: true });
			writeFileSync(
				join(newGeneration, "server/chunks/lazy.mjs"),
				"export const value = 'new asset';",
			);
			writeFileSync(
				join(newGeneration, "server/entry.mjs"),
				"export async function handler() { return (await import('./chunks/lazy.mjs')).value; }",
			);
			const nextVersion = artifactVersion(newGeneration);
			writeFileSync(
				join(site, "version.json"),
				JSON.stringify({ version: nextVersion, generation: newId }),
			);
			expect(getPresentationReadiness("foo")).toMatchObject({
				status: "ready",
				loadedVersion: firstVersion,
				latestVersion: nextVersion,
				pendingRestart: true,
			});
			expect(await oldHandler?.()).toBe("old asset");
			const restarted = await loadPresentations(root);
			expect(await restarted.presentations.get("foo")?.()).toBe("new asset");
			expect(restarted.getPresentationReadiness("foo").pendingRestart).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
