import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { prepareDefaultPresentation } from "../src/multisite.js";
import { linkScaffoldDependencies } from "./scaffold-dependencies.js";

const template = resolve(import.meta.dirname, "../../../templates/blog");
const projects: string[] = [];

afterEach(() => {
	for (const project of projects.splice(0)) rmSync(project, { recursive: true, force: true });
});

describe("default site scaffold", () => {
	it("builds the blog presentation from its site directory with PostgreSQL", () => {
		const testDirectory = resolve(template, "../.astro");
		mkdirSync(testDirectory, { recursive: true });
		const project = mkdtempSync(resolve(testDirectory, "scaffold-test-"));
		projects.push(project);
		cpSync(resolve(template, "src"), resolve(project, "src"), { recursive: true });
		cpSync(resolve(template, "astro.config.mjs"), resolve(project, "astro.config.mjs"));
		cpSync(resolve(template, "package.json"), resolve(project, "package.json"));
		linkScaffoldDependencies(project);

		prepareDefaultPresentation(project);

		expect(existsSync(resolve(project, "src/default/pages/index.astro"))).toBe(true);
		expect(existsSync(resolve(project, "src/pages/index.astro"))).toBe(false);
		const config = readFileSync(resolve(project, "astro.config.mjs"), "utf8");
		expect(config).toContain('srcDir: "./src/default"');
		expect(config).toContain("postgres({ connectionString: process.env.DATABASE_URL })");
		execFileSync(
			process.execPath,
			[resolve(template, "node_modules/astro/bin/astro.mjs"), "build"],
			{
				cwd: project,
				env: { ...process.env, DATABASE_URL: "postgres://localhost:5432/emdash_test" },
				stdio: "pipe",
				timeout: 120_000,
			},
		);
		expect(existsSync(resolve(project, "dist/server/entry.mjs"))).toBe(true);
	}, 120_000);
});
