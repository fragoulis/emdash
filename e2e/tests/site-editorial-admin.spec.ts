import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { expect, test } from "@playwright/test";

// The Node fixture maps the loopback IP to site-bar; localhost stays on site-default.
const FOO = "http://localhost:4444";
const BAR = "http://127.0.0.1:4444";

test.skip(process.env.EMDASH_E2E_TARGET === "cloudflare", "Uses the Node SQLite fixture");

test("authorized admin edits Foo and Bar without crossing site boundaries", async ({ browser }) => {
	const { tempDataDir } = JSON.parse(
		readFileSync(join(tmpdir(), "emdash-pw-server.json"), "utf8"),
	) as { tempDataDir: string };
	const db = new DatabaseSync(join(tempDataDir, "test.db"));
	try {
		db.prepare("INSERT INTO _emdash_sites (id, slug) VALUES ('site-bar', 'bar')").run();
	} finally {
		db.close();
	}

	const foo = await browser.newContext();
	const bar = await browser.newContext();
	try {
		const fooPage = await foo.newPage();
		const barPage = await bar.newPage();
		await fooPage.goto(`${FOO}/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/content/posts`);
		await fooPage.getByRole("button", { name: "Get Started" }).click();
		await fooPage.goto(`${FOO}/_emdash/admin/content/posts`);
		await expect(fooPage.getByRole("link", { name: "First Post", exact: true })).toBeVisible();
		await barPage.goto(`${BAR}/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/content/posts`);
		await barPage.goto(`${BAR}/_emdash/admin/content/posts`);
		await expect(barPage.getByRole("heading", { name: "Posts" })).toBeVisible();
		await expect(barPage.getByRole("link", { name: "First Post", exact: true })).toHaveCount(0);

		async function createPost(page: typeof fooPage, title: string): Promise<string> {
			await page.getByRole("link", { name: "Add New" }).click();
			await page.locator("#field-title").fill(title);
			await page.getByRole("button", { name: "Save", exact: true }).click();
			await expect(page).toHaveURL(/\/content\/posts\/[A-Z0-9]+/);
			const id = new URL(page.url()).pathname.split("/").at(-1)!;
			await page.reload();
			await expect(page.locator("#field-title")).toHaveValue(title);
			return id;
		}

		const barId = await createPost(barPage, "Bar browser post");
		const fooId = await createPost(fooPage, "Foo browser post");
		for (const [page, origin, ownTitle, foreignTitle, foreignId] of [
			[fooPage, FOO, "Foo browser post", "Bar browser post", barId],
			[barPage, BAR, "Bar browser post", "Foo browser post", fooId],
		] as const) {
			await page.goto(`${origin}/_emdash/admin/content/posts`);
			await expect(page.getByRole("link", { name: ownTitle, exact: true })).toBeVisible();
			await expect(page.getByRole("link", { name: foreignTitle, exact: true })).toHaveCount(0);
			const denied = await page.request.get(`${origin}/_emdash/api/content/posts/${foreignId}`);
			expect(denied.status()).toBe(404);
			await page.goto(`${origin}/_emdash/admin/content/posts/${foreignId}`);
			await expect(page.locator("#field-title")).toHaveCount(0);
		}

		const verify = new DatabaseSync(join(tempDataDir, "test.db"));
		try {
			const ownedBy = verify.prepare("SELECT site_id FROM ec_posts WHERE id = ?");
			expect(ownedBy.get(fooId)?.site_id).toBe("site-default");
			expect(ownedBy.get(barId)?.site_id).toBe("site-bar");
		} finally {
			verify.close();
		}
	} finally {
		await foo.close();
		await bar.close();
	}
});
