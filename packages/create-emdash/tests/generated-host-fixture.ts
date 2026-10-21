import { execFileSync, spawn, type ChildProcess } from "node:child_process";
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
import { createServer } from "node:http";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { main } from "../src/cli.js";
import { startClerkFixture } from "./clerk-fixture.js";
import { linkScaffoldDependencies } from "./scaffold-dependencies.js";

const root = resolve(import.meta.dirname, "../../..");

async function availablePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Expected a TCP address");
	await new Promise<void>((done) => server.close(() => done()));
	return address.port;
}

function killTree(child: ChildProcess, signal: NodeJS.Signals) {
	try {
		if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
		else child.kill(signal);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
	}
}

export async function stopProcess(child: ChildProcess): Promise<void> {
	killTree(child, "SIGTERM");
	if (child.exitCode !== null || child.signalCode !== null) return;
	const timeout = setTimeout(killTree, 5_000, child, "SIGKILL");
	try {
		await new Promise<void>((done) => child.once("close", () => done()));
	} finally {
		clearTimeout(timeout);
	}
}

export async function createGeneratedHost(
	options: {
		workspace?: string;
		signal?: AbortSignal;
		log?: (message: string) => void;
	} = {},
) {
	const workdir = resolve(root, "templates/.astro");
	mkdirSync(workdir, { recursive: true });
	const workspace = options.workspace ?? mkdtempSync(resolve(workdir, "browser-fixture-"));
	const project = resolve(workspace, "site");
	if (existsSync(project)) throw new Error("Reset the existing local installation first");
	mkdirSync(workspace, { recursive: true });
	const container = `emdash-fixture-${crypto.randomUUID()}`;
	const children = new Set<ChildProcess>();
	let clerk: Awaited<ReturnType<typeof startClerkFixture>> | undefined;
	let hostOutput = "";
	let hostErrorOutput = "";
	const log = options.log ?? (() => {});
	log(`Fixture workspace: ${workspace}\nFixture container: ${container}\n`);
	const run = (command: string, args: string[], cwd = root, env = process.env) =>
		new Promise<string>((done, fail) => {
			const child = spawn(command, args, {
				cwd,
				env,
				// Docker creation must finish before cleanup can remove its container.
				signal: command === "docker" ? undefined : options.signal,
				detached: process.platform !== "win32",
				stdio: ["ignore", "pipe", "pipe"],
			});
			children.add(child);
			let output = "";
			child.stdout?.on("data", (chunk) => {
				output += String(chunk);
				log(String(chunk));
			});
			child.stderr?.on("data", (chunk) => {
				output += String(chunk);
				log(String(chunk));
			});
			const timeout = setTimeout(killTree, 180_000, child, "SIGKILL");
			child.once("error", fail);
			child.once("close", (code, signal) => {
				clearTimeout(timeout);
				children.delete(child);
				if (code === 0) done(output);
				else fail(new Error(`${command} failed (${signal ?? code}): ${output}`));
			});
		});
	const close = async (keep = false) => {
		await Promise.all(Array.from(children, stopProcess));
		await clerk?.close();
		if (keep) writeFileSync(resolve(workspace, "postgres-container"), container);
		else {
			try {
				execFileSync("docker", ["rm", "-f", container], { stdio: "ignore", timeout: 15_000 });
			} finally {
				rmSync(workspace, { recursive: true, force: true });
			}
		}
	};
	try {
		const password = crypto.randomUUID();
		await run("docker", [
			"run",
			"-d",
			"--rm",
			"--name",
			container,
			"-p",
			"127.0.0.1::5432",
			"-e",
			`POSTGRES_PASSWORD=${password}`,
			"-e",
			"POSTGRES_DB=test",
			"postgres:16-alpine",
		]);
		options.signal?.throwIfAborted();
		const mapping = await run("docker", ["port", container, "5432"]);
		const pgPort = Number(mapping.match(/127\.0\.0\.1:(\d+)/)?.[1]);
		if (!pgPort) throw new Error("Missing PostgreSQL port");
		for (let attempt = 0; ; attempt++) {
			try {
				await run("docker", ["exec", container, "pg_isready", "-U", "postgres", "-d", "test"]);
				break;
			} catch (error) {
				options.signal?.throwIfAborted();
				if (attempt === 99) throw error;
				await delay(100, undefined, { signal: options.signal });
			}
		}
		const originalCwd = process.cwd();
		const originalArgv = process.argv;
		try {
			process.chdir(workspace);
			process.argv = [
				process.execPath,
				"create-emdash",
				"site",
				"--platform",
				"node",
				"--template",
				"blog",
				"--pm",
				"pnpm",
				"--no-install",
				"--yes",
			];
			await main(async (templateSource, downloadOptions) => {
				const dir = downloadOptions?.dir;
				if (!dir) throw new Error("Scaffold destination is required");
				cpSync(resolve(root, "templates/blog"), dir, {
					recursive: true,
					filter: (source) =>
						!source.split("/").some((part) => ["dist", "node_modules", ".astro"].includes(part)),
				});
				return { name: "blog", tar: "", dir, source: templateSource };
			});
		} finally {
			process.chdir(originalCwd);
			process.argv = originalArgv;
		}
		options.signal?.throwIfAborted();
		const seedPath = resolve(project, "seed/seed.json");
		const seed = JSON.parse(readFileSync(seedPath, "utf8"));
		for (const post of seed.content.posts) delete post.data.featured_image;
		writeFileSync(seedPath, JSON.stringify(seed));
		linkScaffoldDependencies(project);
		symlinkSync(
			resolve(root, "packages/core/node_modules/@emdash-cms/registry-lexicons"),
			resolve(project, "node_modules/@emdash-cms/registry-lexicons"),
			"dir",
		);
		const port = await availablePort();
		const origin = `http://localhost:${port}`;
		clerk = await startClerkFixture(origin);
		const databaseUrl = `postgres://postgres:${password}@127.0.0.1:${pgPort}/test`;
		const generatedEnv = readFileSync(resolve(project, ".env"), "utf8");
		const encryptionKey = generatedEnv.match(/^EMDASH_ENCRYPTION_KEY=(.+)$/m)?.[1];
		if (!encryptionKey) throw new Error("Scaffold did not create an encryption key");
		writeFileSync(resolve(project, ".env"), `${generatedEnv}\nDATABASE_URL=${databaseUrl}\n`);
		const env = {
			...process.env,
			DATABASE_URL: databaseUrl,
			EMDASH_ENCRYPTION_KEY: encryptionKey,
			NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerk.publishableKey,
			CLERK_SECRET_KEY: "sk_test_fixture",
			CLERK_BOOTSTRAP_USER_ID: "user_configured_bootstrap_not_admin",
			CLERK_JWT_KEY: clerk.publicKey,
			EMDASH_CLERK_API_URL: clerk.url,
			PORT: String(port),
			EMDASH_ADMIN_HOST: "localhost",
			EMDASH_DEFAULT_HOST: "default.localhost",
			EMDASH_ADMIN_ORIGIN: origin,
			EMDASH_SITE_URL: `http://default.localhost:${port}`,
			EMDASH_PROXY_TOKEN: "",
		};
		const build = () => run(process.execPath, [resolve(project, "build.mjs")], project, env);
		const startHost = () => {
			hostOutput = "";
			hostErrorOutput = "";
			const child = spawn(process.execPath, [resolve(project, "host.mjs")], {
				cwd: project,
				env,
				signal: options.signal,
				detached: process.platform !== "win32",
				stdio: ["ignore", "pipe", "pipe"],
			});
			children.add(child);
			child.once("error", (error) => {
				hostErrorOutput += String(error);
			});
			child.once("close", () => children.delete(child));
			child.stdout?.on("data", (chunk) => {
				hostOutput += String(chunk);
				log(String(chunk));
			});
			child.stderr?.on("data", (chunk) => {
				hostErrorOutput += String(chunk);
				log(String(chunk));
			});
			return child;
		};
		const query = (sql: string) =>
			execFileSync(
				"docker",
				["exec", container, "psql", "-U", "postgres", "-d", "test", "-t", "-A", "-c", sql],
				{ encoding: "utf8" },
			).trim();
		const addSite = (slug: string) =>
			run(
				process.execPath,
				[resolve(root, "packages/create-emdash/dist/index.mjs"), "site", slug],
				project,
				env,
			);
		return {
			project,
			workspace,
			container,
			port,
			origin,
			env,
			clerk,
			build,
			startHost,
			query,
			addSite,
			close,
			get hostOutput() {
				return hostOutput;
			},
			get hostErrorOutput() {
				return hostErrorOutput;
			},
		};
	} catch (error) {
		await close();
		throw error;
	}
}
