import { expect, it, vi } from "vitest";

import { loadMessages } from "../../src/locales/loadMessages.js";
import { SystemAdminShell } from "../../src/shared-shell.js";
import { render } from "../utils/render.tsx";

it("shows actual system identity, safe navigation, and the supplied logout action", async () => {
	const logout = vi.fn();
	const screen = await render(
		<SystemAdminShell
			locale="en"
			messages={await loadMessages("en")}
			name="Test Admin"
			email="admin@example.test"
			logoutAction={<button onClick={logout}>Sign out</button>}
		>
			<h1>Sites</h1>
		</SystemAdminShell>,
	);
	const sitesLinks = document.querySelectorAll('a[href="/sites"]');
	expect(sitesLinks).toHaveLength(2);
	expect(document.querySelectorAll('a[href]:not([href="/sites"])')).toHaveLength(0);
	await screen.getByRole("button", { name: "Test Admin" }).click();
	expect(screen.getByText("admin@example.test")).toBeInTheDocument();
	await screen.getByRole("button", { name: "Sign out" }).click();
	expect(logout).toHaveBeenCalledOnce();
	expect(screen.getByRole("heading", { name: "Sites" })).toBeInTheDocument();
});
