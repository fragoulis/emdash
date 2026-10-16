import {
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

import * as p from "@clack/prompts";

const SLUG = /^[a-z][a-z0-9-]*$/;

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
	const build = resolve(projectDir, "build.mjs");
	const source = resolve(projectDir, "src/default");
	const destination = resolve(projectDir, "src", slug);
	const seedPath = resolve(projectDir, "seed/seed.json");
	const packagePath = resolve(projectDir, "package.json");
	if (
		![config, host, build, source, seedPath, packagePath].every(existsSync) ||
		!statSync(source).isDirectory() ||
		!readFileSync(config, "utf8").includes("EMDASH_BUILD_SITE") ||
		!readFileSync(host, "utf8").includes("_emdash_site_hosts")
	) {
		throw new Error("Run this command from a generated multi-site installation");
	}
	const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
	if (pkg.emdash?.seed !== "seed/seed.json") {
		throw new Error("Installation has no supported starter seed");
	}
	const require = createRequire(packagePath);
	let dependency: (name: string) => string;
	let kyselyPath: string;
	try {
		dependency = (name) => pathToFileURL(require.resolve(name)).href;
		for (const name of ["pg", "ulidx", "emdash/seed", "emdash/request-context"]) dependency(name);
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
	const hostname = `${slug}.localhost`;
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
				throw new Error("Complete initial setup before adding another site");
			}
			if (setup.rows[0]?.value !== "true" && setup.rows[0]?.value !== true) {
				throw new Error("Complete initial setup before adding another site");
			}
			const migration = await connection.query(
				"SELECT name FROM _emdash_migrations WHERE name = '099_site_menus'",
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
		const { Kysely, PostgresDialect, sql } = await import(kyselyPath);
		const { ulid } = await import(dependency("ulidx"));
		const { applySeed } = await import(dependency("emdash/seed"));
		const { runWithContext } = await import(dependency("emdash/request-context"));
		const db = new Kysely({ dialect: new PostgresDialect({ pool }) });
		await db.transaction().execute(async (trx: typeof db) => {
			await sql`SELECT pg_advisory_xact_lock(hashtext(${slug}))`.execute(trx);
			const sites = await sql`SELECT id, slug FROM _emdash_sites WHERE slug = ${slug}`.execute(trx);
			const hosts =
				await sql`SELECT site_id FROM _emdash_site_hosts WHERE hostname = ${hostname}`.execute(trx);
			const site = sites.rows[0];
			if (site && (hosts.rows[0]?.site_id !== site.id || !site.id.startsWith("site-"))) {
				throw new Error(`Site "${slug}" has a conflicting hostname registration`);
			}
			if (!site && (hosts.rows.length || existsSync(destination))) {
				throw new Error(`Site "${slug}" conflicts with an existing hostname or presentation`);
			}
			if (site) return;

			for (const collection of seed.collections) {
				const rows = await sql`SELECT c.slug, f.slug AS field FROM _emdash_collections c
						LEFT JOIN _emdash_fields f ON f.collection_id = c.id WHERE c.slug = ${collection.slug}`.execute(
					trx,
				);
				if (
					!rows.rows.length ||
					collection.fields.some(
						(field: { slug: string }) =>
							!rows.rows.some((row: { field: string }) => row.field === field.slug),
					)
				) {
					throw new Error(`Shared collection "${collection.slug}" is missing starter fields`);
				}
			}
			for (const taxonomy of seed.taxonomies) {
				const def =
					await sql`SELECT name FROM _emdash_taxonomy_defs WHERE name = ${taxonomy.name} LIMIT 1`.execute(
						trx,
					);
				if (!def.rows.length) throw new Error(`Shared taxonomy "${taxonomy.name}" is missing`);
			}
			const siteId = `site-${ulid()}`;
			await sql`INSERT INTO _emdash_sites (id, slug, active) VALUES (${siteId}, ${slug}, 1)`.execute(
				trx,
			);
			await sql`INSERT INTO _emdash_site_hosts (hostname, site_id) VALUES (${hostname}, ${siteId})`.execute(
				trx,
			);
			await runWithContext({ editMode: false, siteId }, async () => {
				for (const taxonomy of seed.taxonomies) {
					for (const term of taxonomy.terms ?? []) {
						const id = ulid();
						await sql`INSERT INTO taxonomies (id, name, slug, label, locale, translation_group, site_id)
								VALUES (${id}, ${taxonomy.name}, ${term.slug}, ${term.label}, 'en', ${id}, ${siteId})`.execute(
							trx,
						);
					}
				}
				await applySeed(
					trx,
					{
						version: seed.version,
						settings: { ...seed.settings, title: slug, url: `http://${hostname}:4321` },
						bylines: seed.bylines,
						content: seed.content,
						menus: seed.menus,
					},
					{ includeContent: true, skipMediaDownload: true, onConflict: "error" },
				);
			});
		});
		if (!existsSync(destination)) {
			const staging = mkdtempSync(resolve(projectDir, "src", `.site-${slug}-`));
			try {
				cpSync(source, staging, { recursive: true, errorOnExist: true, force: false });
				if (existsSync(destination)) throw new Error(`Presentation for "${slug}" already exists`);
				renameSync(staging, destination);
			} finally {
				rmSync(staging, { recursive: true, force: true });
			}
		}
		console.log(
			`Site ${slug} registered. Run npm run build, then restart npm run start. Open http://${hostname}:4321`,
		);
	} finally {
		await pool.end();
	}
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
