import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const script = resolve(import.meta.dirname, "check-no-major.mjs");
const changesetConfig = resolve(import.meta.dirname, "../../.changeset/config.json");

function checkVersions(versions) {
	const directory = mkdtempSync(join(tmpdir(), "emdash-version-check-"));
	try {
		mkdirSync(join(directory, ".changeset"));
		cpSync(changesetConfig, join(directory, ".changeset/config.json"));
		for (const [name, version] of Object.entries(versions)) {
			const location = join(directory, name);
			mkdirSync(location);
			writeFileSync(join(location, "package.json"), JSON.stringify({ name, version }));
		}
		try {
			execFileSync(process.execPath, [script], { cwd: directory, stdio: "pipe" });
			return true;
		} catch {
			return false;
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test("the CLI can move to 2.x without changing core's 1.x major", () => {
	for (const version of ["1.2.0", "2.0.0"]) {
		if (!checkVersions({ emdash: "1.2.0", "create-emdash": version })) {
			throw new Error(`CLI ${version} should pass the release guard`);
		}
	}
});

test("the release guard still rejects unrelated major bumps", () => {
	for (const versions of [
		{ emdash: "2.0.0", "create-emdash": "2.0.0" },
		{ emdash: "1.2.0", "create-emdash": "3.0.0" },
	]) {
		if (checkVersions(versions))
			throw new Error("Unexpected major version passed the release guard");
	}
});
