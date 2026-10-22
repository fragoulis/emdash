import { LinkButton } from "@cloudflare/kumo";
import { useLingui } from "@lingui/react/macro";
import { SignOut, Shield, Gear, ArrowSquareOut } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { apiFetch } from "../lib/api/client";
import { useCurrentUser } from "../lib/api/current-user";
import { SharedHeaderPresentation, SharedIdentityMenu } from "../shared-shell.js";
import { ThemeToggle } from "./ThemeToggle";

export type { CurrentUser } from "../lib/api/current-user";

async function handleLogout() {
	// Clear the public-site toolbar-bootstrap flag (see Shell.tsx).
	try {
		localStorage.removeItem("emdash-editor");
		localStorage.removeItem("emdash-toolbar-labels");
	} catch {
		// ignore — flag is best-effort
	}
	const res = await apiFetch("/_emdash/api/auth/logout?redirect=/_emdash/admin/login", {
		method: "POST",
		credentials: "same-origin",
	});
	if (res.redirected) {
		window.location.href = res.url;
	} else {
		window.location.href = "/_emdash/admin/login";
	}
}

/**
 * Admin header with mobile menu toggle and user actions.
 * Uses useSidebar() hook from kumo Sidebar.Provider context.
 */
export function Header() {
	const { t } = useLingui();
	const { data: user } = useCurrentUser();

	return (
		// h-[58px] is mirrored by ADMIN_HEADER_HEIGHT_PX in ContentEditor.tsx
		// (the settings sheet offsets its body by it) — change both together.
		<SharedHeaderPresentation>
			{/* View site link */}
			<LinkButton variant="ghost" size="sm" href="/" external>
				<ArrowSquareOut className="h-4 w-4 me-1" />
				{t`View Site`}
			</LinkButton>

			{/* Theme toggle */}
			<ThemeToggle />

			{/* Identity menu and its presentation are shared with host-level admin shells. */}
			<SharedIdentityMenu
				name={user?.name}
				email={user?.email}
				avatarUrl={user?.avatarUrl}
				fallbackName={t`User`}
				links={(closeMenu) => (
					<>
						<Link
							to="/settings/security"
							onClick={closeMenu}
							className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-kumo-tint"
						>
							<Shield className="h-4 w-4" />
							{t`Security Settings`}
						</Link>
						<Link
							to="/settings"
							onClick={closeMenu}
							className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-kumo-tint"
						>
							<Gear className="h-4 w-4" />
							{t`Settings`}
						</Link>
					</>
				)}
				logoutAction={
					<button
						onClick={handleLogout}
						className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-start text-sm text-kumo-danger hover:bg-kumo-danger/10"
					>
						<SignOut className="h-4 w-4" />
						{t`Log out`}
					</button>
				}
			/>
		</SharedHeaderPresentation>
	);
}
