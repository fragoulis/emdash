import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	closeSync,
	fsyncSync,
	writeSync,
} from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

import * as p from "@clack/prompts";

const SLUG = /^[a-z][a-z0-9-]*$/;
const SITE_DOMAIN = /^[a-z0-9.-]+$/;

export async function createSite(args: string[], projectDir = process.cwd()): Promise<void> {
	if (args.length > 1 || args.some((arg) => arg.startsWith("-"))) {
		throw new Error("Usage: npm create emdash@latest site [slug]");
	}
	let slug = args[0];
	if (!slug) {
		const answer = await p.text({
			message: "New site slug?",
			validate: (value) => validateSlug(value) ?? undefined,
		});
		if (p.isCancel(answer)) return;
		slug = answer;
	}
	const invalid = validateSlug(slug);
	if (invalid) throw new Error(invalid);

	const config = resolve(projectDir, "astro.config.mjs");
	const host = resolve(projectDir, "host.mjs");
	const seedPath = resolve(projectDir, "seed/seed.json");
	const packagePath = resolve(projectDir, "package.json");
	if (
		![config, host, seedPath, packagePath].every(existsSync) ||
		!readFileSync(config, "utf8").includes("EMDASH_BUILD_SITE") ||
		!readFileSync(host, "utf8").includes("_emdash_site_hosts")
	) {
		throw new Error("Run this command from a generated multi-site installation");
	}
	const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
	if (pkg.emdash?.seed !== "seed/seed.json")
		throw new Error("Installation has no supported starter seed");
	const require = createRequire(packagePath);
	let dependency: (name: string) => string;
	let kyselyPath: string;
	try {
		dependency = (name) => pathToFileURL(require.resolve(name)).href;
		for (const name of [
			"pg",
			"emdash/seed",
			"emdash/internal/multisite/registry",
			"emdash/storage/local",
		])
			dependency(name);
		kyselyPath = pathToFileURL(
			createRequire(require.resolve("emdash/seed")).resolve("kysely"),
		).href;
	} catch {
		throw new Error("Install the installation dependencies before adding a site");
	}
	const localEnv = existsSync(resolve(projectDir, ".env"))
		? parseEnv(readFileSync(resolve(projectDir, ".env"), "utf8"))
		: {};
	const databaseUrl = process.env.DATABASE_URL || localEnv.DATABASE_URL;
	if (!databaseUrl) throw new Error("DATABASE_URL is required for site creation");
	const pg = await import(dependency("pg"));
	const pool = new pg.default.Pool({
		connectionString: databaseUrl,
		connectionTimeoutMillis: 5000,
		max: 2,
	});
	const defaultHost =
		process.env.EMDASH_DEFAULT_HOST || localEnv.EMDASH_DEFAULT_HOST || "default.localhost";
	const siteDomain =
		process.env.EMDASH_SITE_DOMAIN ||
		localEnv.EMDASH_SITE_DOMAIN ||
		defaultHost.split(".").slice(1).join(".");
	if (!SITE_DOMAIN.test(siteDomain)) throw new Error("Set a valid EMDASH_SITE_DOMAIN");
	const adminOrigin =
		process.env.EMDASH_ADMIN_ORIGIN ||
		localEnv.EMDASH_ADMIN_ORIGIN ||
		`http://localhost:${process.env.PORT || localEnv.PORT || "4321"}`;
	const adminUrl = new URL(adminOrigin);
	const hostname = `${slug}.${siteDomain}`;
	let db: { destroy(): Promise<void> } | undefined;
	try {
		let connection;
		try {
			connection = await pool.connect();
		} catch {
			throw new Error("Cannot reach the installation PostgreSQL database");
		}
		try {
			let setup;
			try {
				setup = await connection.query(
					"SELECT value FROM options WHERE name = 'emdash:setup_complete'",
				);
			} catch {
				throw new Error("Complete initial setup before adding a site");
			}
			if (setup.rows[0]?.value !== "true" && setup.rows[0]?.value !== true) {
				throw new Error("Complete initial setup before adding a site");
			}
			const migration = await connection.query(
				"SELECT name FROM _emdash_migrations WHERE name = '103_site_creation_requests'",
			);
			if (!migration.rowCount)
				throw new Error("Update the installation database before adding a site");
		} finally {
			connection.release();
		}

		const seed = JSON.parse(readFileSync(seedPath, "utf8"));
		if (!Array.isArray(seed.collections) || !Array.isArray(seed.taxonomies)) {
			throw new Error("The starter seed is missing shared collection or taxonomy definitions");
		}
		const { Kysely, PostgresDialect } = await import(kyselyPath);
		const { createRegisteredSite } = await import(dependency("emdash/internal/multisite/registry"));
		const { LocalStorage } = await import(dependency("emdash/storage/local"));
		db = new Kysely({ dialect: new PostgresDialect({ pool }) });
		const title = slug;
		const siteUrl = `${adminUrl.protocol}//${hostname}${adminUrl.port ? `:${adminUrl.port}` : ""}`;
		const payloadHash = createHash("sha256")
			.update(JSON.stringify({ title, slug, hostname, siteUrl, seed }))
			.digest("hex");
		const operationDirectory = resolve(projectDir, ".emdash/site-operations");
		mkdirSync(operationDirectory, { recursive: true, mode: 0o700 });
		const operationPath = resolve(operationDirectory, `${slug}.json`);
		const operation = { payloadHash, requestKey: payloadHash };
		try {
			const fd = openSync(operationPath, "wx", 0o600);
			try {
				writeSync(fd, JSON.stringify(operation));
				fsyncSync(fd);
			} finally {
				closeSync(fd);
			}
		} catch (error) {
			if (!isAlreadyExistsError(error)) throw error;
			let prior: typeof operation;
			try {
				prior = JSON.parse(readFileSync(operationPath, "utf8"));
			} catch (parseError) {
				throw new Error(
					`The saved creation operation for "${slug}" is incomplete; do not remove it until database state is checked`,
					{ cause: parseError },
				);
			}
			if (prior.payloadHash !== payloadHash || prior.requestKey !== payloadHash) {
				throw new Error(
					`Site "${slug}" already has a saved creation operation with different input`,
					{ cause: error },
				);
			}
		}
		const actorScope = `cli:${createHash("sha256").update(resolve(projectDir)).digest("hex")}`;
		const storage = new LocalStorage({
			directory: resolve(projectDir, "uploads"),
			baseUrl: "/_emdash/api/media/file",
		});
		const site = await createRegisteredSite(db, {
			title,
			slug,
			hostname,
			siteUrl,
			actorId: null,
			actorScope,
			actorSource: "cli",
			requestKey: payloadHash,
			seed,
			storage,
		});
		console.log(
			`Site ${site.slug} registered and seeded. Open ${site.domains.map((domain: string) => `${adminUrl.protocol}//${domain}${adminUrl.port ? `:${adminUrl.port}` : ""}`).join(", ")}`,
		);
	} finally {
		if (db) await db.destroy();
		else await pool.end();
	}
}

function isAlreadyExistsError(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function validateSlug(slug: string): string | null {
	if (
		slug === "default" ||
		slug === "admin" ||
		slug === "localhost" ||
		slug.length > 63 ||
		!SLUG.test(slug)
	) {
		return "Use a unique lowercase slug starting with a letter, followed by letters, digits or hyphens (max 63)";
	}
	return null;
}
