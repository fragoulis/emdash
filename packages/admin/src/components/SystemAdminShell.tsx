import { Sidebar } from "@cloudflare/kumo";
import { I18n, type Messages } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { useLingui } from "@lingui/react/macro";
import { Buildings } from "@phosphor-icons/react";
import * as React from "react";

import { getLocaleDir } from "../locales/config.js";
import { LocaleDirectionProvider } from "../locales/index.js";
import {
	SharedHeaderPresentation,
	SharedIdentityMenu,
	SharedShellLayout,
	SharedSidebarBrand,
	SharedSidebarFrame,
	ThemeProvider,
	ThemeToggle,
} from "../shared-shell.js";

export interface SystemAdminShellProps {
	children: React.ReactNode;
	locale: string;
	messages: Messages;
	name?: string;
	email?: string;
	logoutAction: React.ReactNode;
}

export function SystemAdminShell({
	children,
	locale,
	messages,
	name,
	email,
	logoutAction,
}: SystemAdminShellProps) {
	const i18n = React.useMemo(() => {
		const instance = new I18n({ locale });
		instance.load(locale, messages);
		instance.activate(locale);
		return instance;
	}, [locale, messages]);
	return (
		<I18nProvider i18n={i18n}>
			<LocaleDirectionProvider>
				<ThemeProvider>
					<SystemAdminShellBody
						locale={locale}
						name={name}
						email={email}
						logoutAction={logoutAction}
					>
						{children}
					</SystemAdminShellBody>
				</ThemeProvider>
			</LocaleDirectionProvider>
		</I18nProvider>
	);
}

function SystemAdminShellBody({
	children,
	locale,
	name,
	email,
	logoutAction,
}: Omit<SystemAdminShellProps, "messages">) {
	const { t } = useLingui();
	const contextLabel = t`System Administration`;
	const sitesLabel = t`Sites`;
	const userLabel = t`User`;
	return (
		<SharedShellLayout
			sidebarSide={getLocaleDir(locale) === "rtl" ? "right" : "left"}
			sidebar={
				<SharedSidebarFrame
					ariaLabel={contextLabel}
					brand={
						<SharedSidebarBrand
							siteName="EmDash"
							renderLink={(content, className) => (
								<a href="/sites" className={className} aria-label={sitesLabel}>
									{content}
								</a>
							)}
						/>
					}
					footer={
						<span className="min-w-0 truncate px-3 py-2 text-xs text-kumo-subtle group-data-[state=collapsed]/sidebar:hidden">
							{contextLabel}
						</span>
					}
				>
					<Sidebar.Group>
						<Sidebar.GroupLabel>{contextLabel}</Sidebar.GroupLabel>
						<Sidebar.Menu>
							<Sidebar.MenuButton href="/sites" active icon={Buildings}>
								{sitesLabel}
							</Sidebar.MenuButton>
						</Sidebar.Menu>
					</Sidebar.Group>
				</SharedSidebarFrame>
			}
			header={
				<SharedHeaderPresentation>
					<ThemeToggle />
					<SharedIdentityMenu
						name={name}
						email={email}
						fallbackName={userLabel}
						logoutAction={logoutAction}
					/>
				</SharedHeaderPresentation>
			}
		>
			{children}
		</SharedShellLayout>
	);
}
