import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildSource } from "./multisite-build.js";
import { clerkSource } from "./multisite-clerk.js";
import { defaultHostSource } from "./multisite-host.js";
import { clerkLoginPageSource, clerkLoginSource } from "./multisite-login.js";
import { clerkSignOutSource, noAccessPageSource } from "./multisite-no-access.js";
import { readinessSource } from "./multisite-readiness.js";
import { multiSiteReadme } from "./multisite-readme.js";
import { createSitesPageSource } from "./multisite-sites.js";
import { systemSitesSource } from "./multisite-system-sites.js";

export function prepareDefaultPresentation(projectDir: string): void {
	const source = resolve(projectDir, "src");
	const destination = resolve(source, "default");
	const temporary = resolve(projectDir, ".emdash-default-src");
	const configPath = resolve(projectDir, "astro.config.mjs");
	const config = readFileSync(configPath, "utf8");
	const nodeDatabase = 'import { sqlite } from "emdash/db";';
	const sqliteConfig = 'database: sqlite({ url: "file:./data.db" }),';
	const integrationAnchor = "\t\temdash({";
	if (
		!config.includes(nodeDatabase) ||
		!config.includes(sqliteConfig) ||
		!config.includes(integrationAnchor)
	) {
		throw new Error("The blog template database configuration has changed");
	}
	if (existsSync(destination) || existsSync(temporary)) {
		throw new Error("The default presentation already exists");
	}
	renameSync(source, temporary);
	mkdirSync(source);
	renameSync(temporary, destination);
	writeFileSync(
		configPath,
		config
			.replace(nodeDatabase, 'import { postgres } from "emdash/db";')
			.replace(
				'\toutput: "server",',
				'\tsrcDir: `./src/${process.env.EMDASH_BUILD_SITE || "default"}`,\n\toutDir: `./dist/sites/${process.env.EMDASH_BUILD_SITE || "default"}`,\n\toutput: "server",',
			)
			.replace(sqliteConfig, "database: postgres({ connectionString: process.env.DATABASE_URL }),")
			.replace(
				integrationAnchor,
				'\t\temdash({\n\t\t\tsiteUrl: process.env.EMDASH_BUILD_SITE && process.env.EMDASH_BUILD_SITE !== "default" ? `http://${process.env.EMDASH_BUILD_SITE}.localhost:4321` : process.env.EMDASH_SITE_URL || "http://default.localhost:4321",\n\t\t\tauth: { type: "clerk", entrypoint: new URL("./clerk.mjs", import.meta.url).pathname, config: { autoProvision: false } },',
			),
	);
	writeFileSync(resolve(projectDir, "host.mjs"), defaultHostSource);
	writeFileSync(resolve(projectDir, "readiness.mjs"), readinessSource);
	writeFileSync(resolve(projectDir, "build.mjs"), buildSource);
	writeFileSync(resolve(projectDir, "clerk.mjs"), clerkSource);
	writeFileSync(resolve(destination, "pages/login.astro"), clerkLoginPageSource);
	mkdirSync(resolve(destination, "pages/site"), { recursive: true });
	mkdirSync(resolve(destination, "components"), { recursive: true });
	writeFileSync(
		resolve(destination, "pages/sites.astro"),
		createSitesPageSource("../components/ClerkSignOut.js"),
	);
	writeFileSync(resolve(destination, "pages/no-access.astro"), noAccessPageSource);
	writeFileSync(resolve(destination, "components/ClerkSignOut.tsx"), clerkSignOutSource);
	writeFileSync(resolve(destination, "components/SystemSites.tsx"), systemSitesSource);
	writeFileSync(
		resolve(destination, "pages/site/[slug].astro"),
		createSitesPageSource("../../components/ClerkSignOut.js"),
	);
	writeFileSync(resolve(destination, "components/ClerkLogin.tsx"), clerkLoginSource);
	writeFileSync(resolve(projectDir, "README.md"), multiSiteReadme);
	const agentsPath = resolve(projectDir, "AGENTS.md");
	if (existsSync(agentsPath)) {
		writeFileSync(
			agentsPath,
			readFileSync(agentsPath, "utf8")
				.replaceAll("src/", "src/default/")
				.replace(
					"Start the Astro dev server",
					"Build the default presentation and start the Node host",
				)
				.replace("This is an EmDash site", "This is an EmDash multi-site installation"),
		);
	}
}
