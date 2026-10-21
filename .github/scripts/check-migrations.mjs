import { spawnSync } from "node:child_process";

const pattern = /^packages\/core\/src\/database\/migrations\/\d+_[^/]+\.ts$/;
const base = process.env.PROTECTED_BASE_SHA;

function git(args) {
	const result = spawnSync("git", args, { encoding: "utf8" });
	if (result.error) throw new Error(`git ${args[0]} failed: ${result.error.message}`);
	if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
	return result.stdout;
}

function changedPaths(args) {
	return git(args).split("\0").filter(Boolean);
}

try {
	if (!base || base.startsWith("-") || !/^[0-9a-f]{40,64}$/i.test(base)) {
		throw new Error("PROTECTED_BASE_SHA must be a full commit hash");
	}
	git(["cat-file", "-e", `${base}^{commit}`]);
	const mergeBaseResult = spawnSync("git", ["merge-base", base, "HEAD"], { encoding: "utf8" });
	if (mergeBaseResult.error || mergeBaseResult.status !== 0 || !mergeBaseResult.stdout.trim()) {
		throw new Error("PROTECTED_BASE_SHA and HEAD must have a common ancestor");
	}
	const mergeBase = mergeBaseResult.stdout.trim();

	const protectedPaths = new Set(
		git(["ls-tree", "-r", "--name-only", "-z", mergeBase])
			.split("\0")
			.filter((path) => pattern.test(path)),
	);
	const paths = new Set([
		...changedPaths([
			"diff",
			"--name-only",
			"--no-renames",
			"--diff-filter=ACDMRTUXB",
			"-z",
			mergeBase,
			"HEAD",
		]),
		...changedPaths([
			"diff",
			"--cached",
			"--name-only",
			"--no-renames",
			"--diff-filter=ACDMRTUXB",
			"-z",
			"HEAD",
		]),
		...changedPaths(["diff", "--name-only", "--no-renames", "--diff-filter=ACDMRTUXB", "-z"]),
	]);
	const violations = [...paths]
		.filter((path) => protectedPaths.has(path))
		.toSorted((left, right) => left.localeCompare(right));
	if (violations.length) {
		console.error(`Protected migration modules changed since ${base}:`);
		for (const path of violations) console.error(`  ${path}`);
		process.exitCode = 1;
	} else {
		console.log(`Migration immutability check passed for base-present modules at ${base}.`);
	}
} catch (error) {
	console.error(`Migration immutability check failed closed: ${error.message}`);
	process.exitCode = 2;
}
