import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-migrations.mjs", import.meta.url));
const migration = "packages/core/src/database/migrations/001_initial.ts";
const migrations = "packages/core/src/database/migrations";

function git(cwd, ...args) {
	return execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
}

function fixture(run) {
	const cwd = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "migration-guard-"));
	try {
		git(cwd, "init", "-q");
		git(cwd, "config", "user.email", "guard@example.test");
		git(cwd, "config", "user.name", "Migration Guard Test");
		mkdirSync(join(cwd, migrations), { recursive: true });
		writeFileSync(join(cwd, migration), "export const migration = 1;\n");
		writeFileSync(join(cwd, `${migrations}/runner.ts`), "export {};\n");
		git(cwd, "add", ".");
		git(cwd, "commit", "-qm", "base");
		const base = git(cwd, "rev-parse", "HEAD");
		return run({ cwd, base });
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

function invoke(cwd, base) {
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => key !== "PROTECTED_BASE_SHA"),
	);
	return spawnSync(process.execPath, [script], {
		cwd,
		env: { ...env, ...(base === undefined ? {} : { PROTECTED_BASE_SHA: base }) },
		encoding: "utf8",
	});
}

function changeCommit(cwd, path, text) {
	writeFileSync(join(cwd, path), text);
	git(cwd, "add", "-A");
	git(cwd, "commit", "-qm", "change");
}

test("allows a new numbered migration and runner metadata updates", () =>
	fixture(({ cwd, base }) => {
		writeFileSync(join(cwd, `${migrations}/002_added.ts`), "export {};\n");
		writeFileSync(join(cwd, `${migrations}/runner.ts`), "export const updated = true;\n");
		git(cwd, "add", ".");
		git(cwd, "commit", "-qm", "add migration");
		const result = invoke(cwd, base);
		assert.equal(result.status, 0, result.stderr);
	}));

test("rejects modified and deleted base-present migration modules", () =>
	fixture(({ cwd, base }) => {
		changeCommit(cwd, migration, "export const migration = 2;\n");
		const modified = invoke(cwd, base);
		assert.equal(modified.status, 1);
		assert.ok(modified.stderr.includes("001_initial.ts"));
		git(cwd, "reset", "--hard", base);
		git(cwd, "rm", migration);
		git(cwd, "commit", "-qm", "delete migration");
		const deleted = invoke(cwd, base);
		assert.equal(deleted.status, 1);
		assert.ok(deleted.stderr.includes("001_initial.ts"));
	}));

test("rejects renamed and mode-changed base-present modules", () =>
	fixture(({ cwd, base }) => {
		git(cwd, "mv", migration, `${migrations}/009_renamed.ts`);
		git(cwd, "commit", "-qm", "rename migration");
		const renamed = invoke(cwd, base);
		assert.equal(renamed.status, 1);
		assert.ok(renamed.stderr.includes("001_initial.ts"));
		git(cwd, "reset", "--hard", base);
		git(cwd, "update-index", "--chmod=+x", migration);
		git(cwd, "commit", "-qm", "change mode");
		const mode = invoke(cwd, base);
		assert.equal(mode.status, 1);
		assert.ok(mode.stderr.includes("001_initial.ts"));
	}));

test("rejects regular-file to symlink type changes", () =>
	fixture(({ cwd, base }) => {
		unlinkSync(join(cwd, migration));
		symlinkSync("runner.ts", join(cwd, migration));
		git(cwd, "add", "-A");
		git(cwd, "commit", "-qm", "replace module with symlink");
		const result = invoke(cwd, base);
		assert.equal(result.status, 1);
		assert.ok(result.stderr.includes("001_initial.ts"));
	}));

test("checks staged and unstaged local changes", () =>
	fixture(({ cwd, base }) => {
		writeFileSync(join(cwd, migration), "export const migration = 2;\n");
		assert.equal(invoke(cwd, base).status, 1);
		git(cwd, "add", migration);
		writeFileSync(join(cwd, migration), "export const migration = 3;\n");
		assert.equal(invoke(cwd, base).status, 1);
	}));

test("protects common-base modules across divergent base and feature branches", () =>
	fixture(({ cwd }) => {
		git(cwd, "branch", "feature");
		git(cwd, "checkout", "-q", "-b", "protected-base");
		writeFileSync(join(cwd, `${migrations}/002_from_base.ts`), "export {};\n");
		git(cwd, "add", ".");
		git(cwd, "commit", "-qm", "base branch migration");
		const protectedBase = git(cwd, "rev-parse", "HEAD");
		git(cwd, "checkout", "-q", "feature");
		writeFileSync(join(cwd, `${migrations}/002_from_base.ts`), "export const feature = true;\n");
		writeFileSync(join(cwd, migration), "export const migration = 2;\n");
		git(cwd, "add", ".");
		git(cwd, "commit", "-qm", "feature migration and protected edit");
		const result = invoke(cwd, protectedBase);
		assert.equal(result.status, 1);
		assert.ok(result.stderr.includes("001_initial.ts"));
		assert.equal(result.stderr.includes("002_from_base.ts"), false);
	}));

test("fails closed for missing, invalid, and unrelated base commits", () =>
	fixture(({ cwd, base }) => {
		const missing = invoke(cwd);
		assert.notEqual(missing.status, 0);
		assert.ok(missing.stderr.includes("PROTECTED_BASE_SHA"));
		const invalid = invoke(cwd, "not-a-commit");
		assert.notEqual(invalid.status, 0);
		assert.ok(invalid.stderr.includes("full commit hash"));
		const missingCommit = invoke(cwd, "0".repeat(40));
		assert.notEqual(missingCommit.status, 0);
		assert.ok(missingCommit.stderr.includes("git cat-file failed"));
		git(cwd, "checkout", "--orphan", "unrelated");
		git(cwd, "rm", "-rf", ".");
		writeFileSync(join(cwd, "other.txt"), "other\n");
		git(cwd, "add", ".");
		git(cwd, "commit", "-qm", "unrelated root");
		const unrelated = invoke(cwd, base);
		assert.notEqual(unrelated.status, 0);
		assert.ok(unrelated.stderr.toLowerCase().includes("common ancestor"));
	}));
