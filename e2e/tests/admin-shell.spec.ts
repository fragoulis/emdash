import { test, expect } from "../fixtures";

const cases = [
	{ locale: "en", theme: "light", width: 1440, height: 900, rtl: false },
	{ locale: "en", theme: "dark", width: 1440, height: 900, rtl: false },
	{ locale: "ar", theme: "light", width: 1440, height: 900, rtl: true },
	{ locale: "ar", theme: "dark", width: 1440, height: 900, rtl: true },
	{ locale: "en", theme: "light", width: 390, height: 900, rtl: false },
	{ locale: "en", theme: "dark", width: 390, height: 900, rtl: false },
	{ locale: "ar", theme: "light", width: 390, height: 900, rtl: true },
	{ locale: "ar", theme: "dark", width: 390, height: 900, rtl: true },
];

for (const { locale, theme, width, height, rtl } of cases) {
	test(`normal admin shell ${locale} ${theme} ${width}x${height}`, async ({
		page,
		admin,
	}, testInfo) => {
		await page.setViewportSize({ width: 1440, height });
		await admin.devBypassAuth();
		await page.setViewportSize({ width, height });
		await page
			.context()
			.addCookies([
				{ name: "emdash-locale", value: locale, domain: "localhost", path: "/_emdash" },
			]);
		await page.evaluate((mode) => localStorage.setItem("emdash-theme", mode), theme);
		await admin.goto();

		const root = page.locator("html");
		await expect(root).toHaveAttribute("lang", locale);
		await expect(root).toHaveAttribute("dir", rtl ? "rtl" : "ltr");
		await expect(root).toHaveAttribute("data-mode", theme);
		const header = page.locator("header").first();
		await expect(header).toBeVisible();
		await expect(header).toHaveCSS("height", "58px");
		const trigger = page.locator(
			'header [aria-label="Collapse sidebar"], header [aria-label="Expand sidebar"]',
		);
		const main = page.locator("main").first();
		await expect(main).toBeVisible();
		await page.screenshot({
			path: testInfo.outputPath(`${locale}-${theme}-${width}-shell.png`),
			fullPage: true,
			animations: "disabled",
		});

		if (width > 600) {
			const sidebar = page.locator('[data-sidebar="sidebar"]:visible').first();
			await expect(sidebar).toBeVisible();
			const boxes = await Promise.all([sidebar.boundingBox(), main.boundingBox()]);
			expect(boxes[0]).not.toBeNull();
			expect(boxes[1]).not.toBeNull();
			if (rtl) expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(boxes[0]!.x);
			else expect(boxes[0]!.x + boxes[0]!.width).toBeLessThanOrEqual(boxes[1]!.x);
		} else {
			await expect(trigger).toBeVisible();
			await trigger.click();
			const sidebar = page.locator('[data-sidebar="sidebar"][data-mobile="true"]');
			await expect(sidebar).toBeVisible();
			await expect(sidebar).toHaveAttribute("aria-hidden", "false");
			const box = await sidebar.boundingBox();
			expect(box).not.toBeNull();
			if (rtl) expect(box!.x + box!.width).toBeGreaterThan(width - 2);
			else expect(box!.x).toBeLessThan(2);
			const selectedNavigation = sidebar
				.locator('a[data-sidebar="menu-button"][aria-current="page"]')
				.first();
			await expect(selectedNavigation).toBeVisible();
			await expect(selectedNavigation).toHaveAccessibleName(/.+/);
			await page.keyboard.press("Escape");
			await expect(sidebar).toHaveAttribute("aria-hidden", "true");
			await expect(trigger).toBeFocused();
			await expect(main).toBeVisible();
		}

		const userButton = page.getByRole("button", { name: /Dev Admin/i }).first();
		await expect(userButton).toBeVisible();
		await userButton.click();
		await expect(page.getByText("dev@emdash.local")).toBeVisible();
		const menu = page
			.locator(".kumo-popover-popup:visible")
			.filter({ hasText: "dev@emdash.local" })
			.last();
		await expect(menu).toHaveCSS("opacity", "1");
		const menuBox = await menu.boundingBox();
		expect(menuBox).not.toBeNull();
		expect(menuBox!.x).toBeGreaterThanOrEqual(0);
		expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(width);
		await page.screenshot({
			path: testInfo.outputPath(`${locale}-${theme}-${width}-user-menu.png`),
			fullPage: true,
			animations: "disabled",
		});
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			width,
		);
		await userButton.click();
		await expect(menu).toBeHidden();
		const nextTheme = theme === "light" ? "dark" : "light";
		const themeLabel =
			locale === "en"
				? nextTheme === "dark"
					? "Switch to dark"
					: "Switch to light"
				: nextTheme === "dark"
					? "التبديل إلى الداكن"
					: "التبديل إلى الفاتح";
		const themeButton = header.getByRole("button", { name: themeLabel, exact: true });
		await themeButton.click();
		const persistedTheme = nextTheme;
		await expect(root).toHaveAttribute("data-mode", persistedTheme);
		await page.reload();
		await expect(root).toHaveAttribute("data-mode", persistedTheme);
	});
}
