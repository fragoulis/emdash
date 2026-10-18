import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "../../../src/database/connection.js";
import { runMigrations } from "../../../src/database/migrations/runner.js";
import { ensureBuilt } from "../server.js";

const CLI_BIN = resolve(import.meta.dirname, "../../../dist/cli/index.mjs");

type CliResult = { code: number | null; stdout: string; stderr: string };

describe("seed site selection CLI", () => {
	let projectRoot: string;
	let dbPath: string;

	beforeAll(async () => {
		await ensureBuilt();
		projectRoot = await mkdtemp(join(tmpdir(), "emdash-seed-sites-"));
		dbPath = join(projectRoot, "data.db");
		const db = createDatabase({ url: `file:${dbPath}` });
		try {
			await runMigrations(db);
			await sql`INSERT INTO _emdash_sites (id, slug, active) VALUES (${"foo"}, ${"foo"}, ${1}), (${"bar"}, ${"bar"}, ${1})`.execute(
				db,
			);
		} finally {
			await db.destroy();
		}
	});

	afterAll(async () => {
		if (projectRoot) await rm(projectRoot, { force: true, recursive: true });
	});

	async function writeSeed(name: string, settings: Record<string, string>) {
		const path = join(projectRoot, `${name}.json`);
		await writeFile(path, JSON.stringify({ version: "1", settings }));
		return path;
	}

	function run(...args: string[]): CliResult {
		const result = spawnSync("node", [CLI_BIN, ...args], {
			cwd: projectRoot,
			encoding: "utf8",
			env: { ...process.env, NO_COLOR: "1" },
			timeout: 30_000,
		});
		if (result.error) throw result.error;
		return { code: result.status, stdout: result.stdout, stderr: result.stderr };
	}

	function seed(path: string, siteId: string, ...options: string[]) {
		return run(
			"seed",
			path,
			"--site-id",
			siteId,
			"--database",
			dbPath,
			"--cwd",
			projectRoot,
			"--no-content",
			...options,
		);
	}

	function exportSite(siteId: string): CliResult {
		return run("export-seed", "--site-id", siteId, "--database", dbPath, "--cwd", projectRoot);
	}

	function exportedSettings(siteId: string) {
		const result = exportSite(siteId);
		expect(result.code).toBe(0);
		return JSON.parse(result.stdout).settings;
	}

	it("applies, exports, and updates settings only for the selected site", async () => {
		const foo = await writeSeed("foo", {
			title: "Foo title",
			tagline: "Foo tagline",
			fooOnly: "Foo-only setting",
		});
		const bar = await writeSeed("bar", {
			title: "Bar title",
			tagline: "Bar tagline",
			barOnly: "Bar-only setting",
		});

		const fooSeed = seed(foo, "foo");
		expect(fooSeed.code, `Foo seed failed: ${fooSeed.stderr}\n${fooSeed.stdout}`).toBe(0);
		const barSeed = seed(bar, "bar");
		expect(barSeed.code, `Bar seed failed: ${barSeed.stderr}\n${barSeed.stdout}`).toBe(0);
		expect(exportedSettings("foo")).toEqual({
			title: "Foo title",
			tagline: "Foo tagline",
			fooOnly: "Foo-only setting",
		});
		expect(exportedSettings("bar")).toEqual({
			title: "Bar title",
			tagline: "Bar tagline",
			barOnly: "Bar-only setting",
		});

		const updatedFoo = await writeSeed("foo-update", {
			title: "Updated Foo",
			tagline: "Updated Foo tagline",
			fooOnly: "Updated Foo-only setting",
		});
		const updateResult = seed(updatedFoo, "foo", "--on-conflict", "update");
		expect(
			updateResult.code,
			`Foo update failed: ${updateResult.stderr}\n${updateResult.stdout}`,
		).toBe(0);
		expect(exportedSettings("foo")).toEqual({
			title: "Updated Foo",
			tagline: "Updated Foo tagline",
			fooOnly: "Updated Foo-only setting",
		});
		expect(exportedSettings("bar")).toEqual({
			title: "Bar title",
			tagline: "Bar tagline",
			barOnly: "Bar-only setting",
		});
	});

	it("requires --site-id without changing the database", async () => {
		const path = await writeSeed("unscoped", { title: "Must not write" });
		const before = await readFile(dbPath);
		const result = run("seed", path, "--database", dbPath, "--cwd", projectRoot, "--no-content");

		expect(result.code).not.toBe(0);
		expect(`${result.stdout}${result.stderr}`).toMatch(/site-id/i);
		expect(await readFile(dbPath)).toEqual(before);
	});
});
