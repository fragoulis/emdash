import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("generated Admin dependency compatibility", () => {
	it("scaffolds with the matching Admin version from a copied CLI outside the monorepo", () => {
		const packageRoot = resolve(import.meta.dirname, "..");
		const repoRoot = resolve(packageRoot, "../..");
		const scratchParent = process.env.EMDASH_TASK_VALIDATION_RUN ?? tmpdir();
		const scratch = mkdtempSync(resolve(scratchParent, "admin-dependency-"));
		try {
			const isolated = resolve(scratch, "copied-cli");
			const cliDir = resolve(isolated, "packages/create-emdash");
			const cliNodeModules = resolve(cliDir, "node_modules");
			const cliPackage = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as {
				dependencies: Record<string, string>;
			};
			cpSync(resolve(packageRoot, "dist"), resolve(cliDir, "dist"), { recursive: true });
			cpSync(resolve(packageRoot, "package.json"), resolve(cliDir, "package.json"));
			for (const dependency of Object.keys(cliPackage.dependencies)) {
				const linkPath = resolve(cliNodeModules, dependency);
				mkdirSync(resolve(linkPath, ".."), { recursive: true });
				symlinkSync(resolve(packageRoot, "node_modules", dependency), linkPath, "dir");
			}

			const fixtureTemplate = resolve(scratch, "template");
			cpSync(resolve(repoRoot, "templates/blog"), fixtureTemplate, {
				recursive: true,
				filter: (source) => !["node_modules", "dist", ".astro"].includes(basename(source)),
			});
			const hook = resolve(scratch, "giget-hook.mjs");
			writeFileSync(
				hook,
				`import { registerHooks } from "node:module";\nregisterHooks({ resolve(specifier, context, nextResolve) { if (specifier === "giget") return { url: "emdash:giget", shortCircuit: true }; return nextResolve(specifier, context); }, load(url, context, nextLoad) { if (url === "emdash:giget") return { format: "module", shortCircuit: true, source: \`import { cpSync } from "node:fs"; export async function downloadTemplate(_source, options) { cpSync(${JSON.stringify(fixtureTemplate)}, options.dir, { recursive: true }); return { ...options, name: "blog", tar: "" }; }\` }; return nextLoad(url, context); } });\n`,
			);

			const result = spawnSync(
				process.execPath,
				[
					"--import",
					hook,
					resolve(cliDir, "dist/index.mjs"),
					"isolated-project",
					"--platform",
					"node",
					"--template",
					"blog",
					"--pm",
					"npm",
					"--no-install",
					"--yes",
				],
				{
					cwd: scratch,
					encoding: "utf8",
					env: { ...process.env, NO_COLOR: "1" },
					timeout: 30_000,
				},
			);
			expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
			const scaffolded = JSON.parse(
				readFileSync(resolve(scratch, "isolated-project/package.json"), "utf8"),
			) as { dependencies: Record<string, string> };
			const adminManifest = JSON.parse(
				readFileSync(resolve(repoRoot, "packages/admin/package.json"), "utf8"),
			) as { version: string };
			expect(scaffolded.dependencies["@emdash-cms/admin"]).toBe(`^${adminManifest.version}`);
			expect(existsSync(resolve(cliDir, "../admin/package.json"))).toBe(false);
		} finally {
			rmSync(scratch, { recursive: true, force: true });
		}
	}, 45_000);
});
