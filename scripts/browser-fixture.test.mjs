import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const workspacePattern = /^Fixture workspace: (.+)$/m;
const containerPattern = /^Fixture container: (.+)$/m;

async function capture(t, args, interrupt) {
	const output = mkdtempSync(resolve(tmpdir(), "emdash-browser-test-"));
	t.after(() => rmSync(output, { recursive: true, force: true }));
	for (const file of ["page.png", "page.aria.yml", "capture.json"])
		writeFileSync(resolve(output, file), "Stale evidence");
	const child = spawn(
		process.execPath,
		["--import", "tsx", "scripts/browser-fixture.ts", "--output", output, ...args],
		{ cwd: root, stdio: ["ignore", "pipe", "pipe"] },
	);
	let terminal = "";
	child.stdout.on("data", (chunk) => {
		terminal += String(chunk);
	});
	child.stderr.on("data", (chunk) => {
		terminal += String(chunk);
	});
	const exited = new Promise((done, fail) => {
		child.once("error", fail);
		child.once("close", (code, signal) => done({ code, signal }));
	});
	t.after(async () => {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill("SIGTERM");
			await exited;
		}
	});
	if (interrupt) {
		const deadline = Date.now() + 60_000;
		while (true) {
			const log = existsSync(resolve(output, "host.log"))
				? readFileSync(resolve(output, "host.log"), "utf8")
				: "";
			if (
				log.includes(interrupt === "startup" ? "Fixture container:" : "Building server entrypoints")
			)
				break;
			assert.equal(child.exitCode, null, terminal);
			assert.ok(Date.now() < deadline, terminal);
			await delay(100);
		}
		child.kill(interrupt === "startup" ? "SIGINT" : "SIGTERM");
	}
	const result = await exited;
	const log = readFileSync(resolve(output, "host.log"), "utf8");
	const workspace = workspacePattern.exec(log)?.[1];
	const container = containerPattern.exec(log)?.[1];
	assert.ok(workspace, log);
	assert.ok(container, log);
	assert.equal(existsSync(workspace), false, "Generated workspace must be removed");
	assert.throws(
		() => execFileSync("docker", ["inspect", container], { stdio: "ignore" }),
		"Database container must be removed",
	);
	const processes = execFileSync("ps", ["-eo", "args"], { encoding: "utf8" });
	assert.equal(processes.includes(workspace), false, "Generated host and build children must stop");
	return { output, log, terminal, ...result };
}

await test(
	"captures a loaded authenticated registry and removes disposable services",
	{ timeout: 180_000 },
	async (t) => {
		const result = await capture(t, ["--path", "/sites"]);
		assert.equal(result.code, 0, result.terminal + result.log);
		const snapshot = readFileSync(resolve(result.output, "page.aria.yml"), "utf8");
		assert.ok(snapshot.includes("/url: /site/foo"), snapshot);
		assert.ok(snapshot.includes("/url: /site/bar"), snapshot);
		assert.equal(snapshot.includes("Loading sites"), false);
		assert.equal(readFileSync(resolve(result.output, "browser.log"), "utf8"), "");
		const image = readFileSync(resolve(result.output, "page.png"));
		assert.equal(image.subarray(1, 4).toString(), "PNG");
		const metadata = JSON.parse(readFileSync(resolve(result.output, "capture.json"), "utf8"));
		await assert.rejects(fetch(metadata.url, { signal: AbortSignal.timeout(1000) }));
	},
);

await test(
	"retains failure logs and removes services when a page cannot open",
	{ timeout: 180_000 },
	async (t) => {
		const result = await capture(t, ["--path", "/missing-fixture-page"]);
		assert.equal(result.code, 1, result.terminal);
		assert.ok(result.log.includes("Page did not open with authenticated access"), result.log);
		for (const file of ["page.png", "page.aria.yml", "capture.json"])
			assert.equal(existsSync(resolve(result.output, file)), false);
	},
);

await test(
	"SIGTERM during an Astro build removes the container, workspace, and build children",
	{ timeout: 180_000 },
	async (t) => {
		const result = await capture(t, [], "build");
		assert.equal(result.code, 143, result.terminal);
		assert.equal(existsSync(resolve(result.output, "page.png")), false);
	},
);

await test(
	"SIGINT during startup removes the disposable installation",
	{ timeout: 180_000 },
	async (t) => {
		const result = await capture(t, [], "startup");
		assert.equal(result.code, 130, result.terminal);
		assert.equal(existsSync(resolve(result.output, "page.png")), false);
	},
);
