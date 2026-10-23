import { describe, expect, it, vi } from "vitest";

import {
	SharedHeaderPresentation,
	SharedIdentityMenu,
	SharedLogoutButton,
	SharedShellLayout,
	SharedSidebarBrand,
	SharedSidebarFrame,
} from "../../src/shared-shell.js";
import { render } from "../utils/render.tsx";

describe("shared admin shell presentation", () => {
	it("forwards logout activation and disabled state through the shared Kumo control", async () => {
		const onClick = vi.fn();
		const screen = await render(
			<>
				<SharedLogoutButton onClick={onClick}>Log out</SharedLogoutButton>
				<SharedLogoutButton onClick={onClick} disabled>
					Sign out
				</SharedLogoutButton>
			</>,
		);

		const logout = screen.getByRole("button", { name: "Log out" });
		const signOut = screen.getByRole("button", { name: "Sign out" });
		expect(logout).toBeEnabled();
		expect(signOut).toBeDisabled();
		await logout.click();
		expect(onClick).toHaveBeenCalledOnce();
	});

	it("renders supplied navigation, identity actions, logout, and page content without a site context", async () => {
		const logout = vi.fn();
		const screen = await render(
			<SharedShellLayout
				sidebar={
					<SharedSidebarFrame
						ariaLabel="System navigation"
						brand={
							<SharedSidebarBrand
								siteName="EmDash"
								renderLink={(children, className) => (
									<a href="/" className={className}>
										{children}
									</a>
								)}
							/>
						}
					>
						<a href="/sites">Sites</a>
					</SharedSidebarFrame>
				}
				header={
					<SharedHeaderPresentation>
						<SharedIdentityMenu
							name="Admin Person"
							email="admin@example.test"
							fallbackName="User"
							links={(close) => (
								<a href="/sites" onClick={close}>
									Sites
								</a>
							)}
							logoutAction={<button onClick={logout}>Sign out</button>}
						/>
					</SharedHeaderPresentation>
				}
			>
				<p>System page</p>
			</SharedShellLayout>,
		);

		expect(document.querySelector('[aria-label="System navigation"]')).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Sites" })).toHaveAttribute("href", "/sites");
		expect(document.querySelector('a[href="/"]')).toHaveClass("flex", "items-center");
		await screen.getByRole("button", { name: "Admin Person" }).click();
		expect(screen.getByText("admin@example.test")).toBeInTheDocument();
		await screen.getByRole("button", { name: "Sign out" }).click();
		expect(logout).toHaveBeenCalledOnce();
		expect(document.querySelector("main")).toHaveClass("overflow-y-auto", "p-6");
		expect(screen.getByText("System page")).toBeInTheDocument();
	});

	it("uses email as the identity heading when no name is supplied", async () => {
		const screen = await render(
			<SharedIdentityMenu
				email="admin@example.test"
				fallbackName="User"
				logoutAction={<button>Sign out</button>}
			/>,
		);

		const identityButton = screen.getByRole("button", { name: "admin@example.test" });
		expect(identityButton).toBeInTheDocument();
		await identityButton.click();
		const popupText = document.querySelector(".kumo-popover-popup")?.textContent ?? "";
		expect(popupText.match(/admin@example\.test/g)).toHaveLength(1);
	});

	it("keeps full-bleed page layout available to the normal admin", async () => {
		await render(
			<SharedShellLayout
				fullBleed
				sidebar={<aside />}
				header={
					<SharedHeaderPresentation>
						<span>Actions</span>
					</SharedHeaderPresentation>
				}
			>
				<p>Editor</p>
			</SharedShellLayout>,
		);

		expect(document.querySelector("main")).toHaveClass("overflow-clip", "min-h-0");
	});
});
