import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";

import { chromium, type Browser } from "@playwright/test";

import { createGeneratedHost } from "../packages/create-emdash/tests/generated-host-fixture.js";

const invalidPathPattern = /[\\\r\n]/;
const viewportPattern = /^(\d+)x(\d+)$/;
const deniedPathPattern = /^\/(login|no-access)$/;

const { values } = parseArgs({
	options: {
		path: { type: "string", default: "/sites" },
		output: { type: "string" },
		locale: { type: "string", default: "en" },
		viewport: { type: "string", default: "1440x900" },
		"wait-for": { type: "string" },
		interactive: { type: "boolean", default: false },
		help: { type: "boolean", short: "h" },
	},
});
if (values.help) {
	console.log(`Usage: pnpm browser:fixture [options]

Generate a disposable host with Foo and Bar sites and a fixture super admin.
Requires built workspace packages, Docker, and Playwright Chromium. No live Clerk keys.

  --path /sites          Local admin path to capture
  --output DIRECTORY     Evidence directory (default: a new directory in the OS temp folder)
  --locale en            Browser locale (use ar for RTL)
  --viewport 1440x900     Viewport width and height
  --wait-for SELECTOR    Additional visible element to wait for before capture
  --interactive          Open a visible browser; press Enter or close it to clean up
  --help                 Show this help

Screenshots and logs remain after cleanup. SIGINT and SIGTERM also clean up.`);
} else {
	await main();
}

async function main() {
	if (
		!values.path.startsWith("/") ||
		values.path.startsWith("//") ||
		invalidPathPattern.test(values.path)
	) {
		throw new Error("--path must be a local absolute path");
	}
	const dimensions = viewportPattern.exec(values.viewport);
	const width = Number(dimensions?.[1]);
	const height = Number(dimensions?.[2]);
	if (!width || !height || width > 7680 || height > 7680)
		throw new Error("--viewport must be WIDTHxHEIGHT, up to 7680x7680");
	const output = values.output
		? resolve(values.output)
		: mkdtempSync(resolve(tmpdir(), "emdash-evidence-"));
	const disposableRoot = resolve(import.meta.dirname, "../templates/.astro");
	if (output === disposableRoot || output.startsWith(`${disposableRoot}${sep}`))
		throw new Error("Evidence must be outside templates/.astro");
	mkdirSync(output, { recursive: true, mode: 0o700 });
	for (const file of ["page.png", "page.aria.yml", "capture.json"])
		rmSync(resolve(output, file), { force: true });
	const logPath = resolve(output, "host.log");
	const browserLogPath = resolve(output, "browser.log");
	writeFileSync(logPath, "");
	writeFileSync(browserLogPath, "");
	console.log(`Evidence: ${output}`);
	const controller = new AbortController();
	const interrupt = (signal: NodeJS.Signals) => {
		process.exitCode = signal === "SIGINT" ? 130 : 143;
		controller.abort(new Error(`Interrupted by ${signal}`));
	};
	const onSigint = () => interrupt("SIGINT");
	const onSigterm = () => interrupt("SIGTERM");
	process.on("SIGINT", onSigint);
	process.on("SIGTERM", onSigterm);
	let fixture: Awaited<ReturnType<typeof createGeneratedHost>> | undefined;
	let browser: Browser | undefined;
	let renewal: ReturnType<typeof setInterval> | undefined;
	const closeBrowser = () => {
		void browser?.close();
	};
	controller.signal.addEventListener("abort", closeBrowser);
	try {
		fixture = await createGeneratedHost({
			signal: controller.signal,
			log: (message) => appendFileSync(logPath, message),
		});
		console.log("Building generated host...");
		await fixture.build();
		const host = fixture.startHost();
		let ready = false;
		for (let attempt = 0; attempt < 150; attempt++) {
			controller.signal.throwIfAborted();
			if (host.exitCode !== null || host.signalCode !== null)
				throw new Error("Generated host exited before readiness");
			try {
				const response = await fetch(`${fixture.origin}/login`, {
					signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1000)]),
				});
				if (response.ok) {
					ready = true;
					break;
				}
			} catch {
				controller.signal.throwIfAborted();
			}
			await delay(100, undefined, { signal: controller.signal });
		}
		if (!ready) throw new Error("Generated host did not become ready");
		await fixture.addSite("foo");
		await fixture.addSite("bar");
		browser = await chromium.launch({ headless: !values.interactive });
		controller.signal.throwIfAborted();
		const context = await browser.newContext({
			locale: values.locale,
			viewport: { width, height },
		});
		const authenticate = () =>
			context.addCookies([
				{ name: "__session", value: fixture!.clerk.jwt(), url: fixture!.origin },
			]);
		await authenticate();
		renewal = setInterval(() => {
			void authenticate().catch((error) =>
				appendFileSync(browserLogPath, `Cookie renewal: ${String(error)}\n`),
			);
		}, 60_000);
		const page = await context.newPage();
		page.on("pageerror", (error) => appendFileSync(browserLogPath, `${String(error)}\n`));
		page.on("console", (message) => {
			if (message.type() === "error")
				appendFileSync(browserLogPath, `${message.text()} ${message.location().url}\n`);
		});
		page.on("response", (response) => {
			if (response.status() >= 400)
				appendFileSync(browserLogPath, `HTTP ${response.status()} ${response.url()}\n`);
		});
		page.on("requestfailed", (request) =>
			appendFileSync(
				browserLogPath,
				`${request.method()} ${request.url()}: ${request.failure()?.errorText}\n`,
			),
		);
		const access = await context.request.get(`${fixture.origin}/_emdash/api/system/sites`);
		if (access.status() !== 200)
			throw new Error(`Fixture authentication failed (${access.status()})`);
		const response = await page.goto(`${fixture.origin}${values.path}`);
		if (
			!response?.ok() ||
			new URL(page.url()).origin !== fixture.origin ||
			deniedPathPattern.test(new URL(page.url()).pathname)
		)
			throw new Error(`Page did not open with authenticated access: ${page.url()}`);
		await page.locator("main h1").first().waitFor();
		const pathname = new URL(page.url()).pathname;
		if (pathname === "/sites") {
			await page.locator('main a[href="/site/foo"]').waitFor();
			await page.locator('main a[href="/site/bar"]').waitFor();
		} else if (pathname.startsWith("/site/")) {
			await page.locator("main section form input").first().waitFor();
		}
		if (values["wait-for"]) await page.locator(values["wait-for"]).waitFor();
		await page.evaluate(() => document.fonts.ready);
		writeFileSync(resolve(output, "page.aria.yml"), await page.locator("body").ariaSnapshot());
		await page.screenshot({ path: resolve(output, "page.png"), fullPage: true });
		writeFileSync(
			resolve(output, "capture.json"),
			JSON.stringify(
				{
					url: page.url(),
					locale: values.locale,
					viewport: { width, height },
					screenshot: "page.png",
				},
				null,
				2,
			),
		);
		console.log(`Screenshot: ${resolve(output, "page.png")}`);
		if (values.interactive) {
			console.log(
				`Authenticated browser: ${page.url()}\nPress Enter or close the browser to stop.`,
			);
			await new Promise<void>((done) => {
				const finish = () => {
					process.stdin.off("data", finish);
					process.stdin.pause();
					controller.signal.removeEventListener("abort", finish);
					done();
				};
				browser!.once("disconnected", finish);
				controller.signal.addEventListener("abort", finish, { once: true });
				process.stdin.once("data", finish);
				process.stdin.resume();
			});
		}
	} catch (error) {
		appendFileSync(logPath, `\n${String(error)}\n`);
		console.error(`${String(error)}\nSee ${logPath}`);
		process.exitCode ||= 1;
	} finally {
		if (renewal) clearInterval(renewal);
		try {
			await browser?.close();
		} finally {
			try {
				await fixture?.close();
			} finally {
				process.off("SIGINT", onSigint);
				process.off("SIGTERM", onSigterm);
				controller.signal.removeEventListener("abort", closeBrowser);
			}
		}
	}
}
