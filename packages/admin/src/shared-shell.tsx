import { Button, Popover, Sidebar } from "@cloudflare/kumo";
import * as React from "react";

import { BrandIcon } from "./components/Logo.js";

export { ThemeProvider } from "./components/ThemeProvider.js";
export { ThemeToggle } from "./components/ThemeToggle.js";

export interface SharedShellLayoutProps {
	children: React.ReactNode;
	sidebar: React.ReactNode;
	header: React.ReactNode;
	beforeMain?: React.ReactNode;
	afterMain?: React.ReactNode;
	sidebarSide?: "left" | "right";
	/** Route renders edge-to-edge: the Shell's <main> drops its padding and page scroll, and the route's component manages its own scroll regions. */
	fullBleed?: boolean;
}

/** Provider and page frame shared by the site admin and host-level admin apps. */
export function SharedShellLayout({
	children,
	sidebar,
	header,
	beforeMain,
	afterMain,
	sidebarSide = "left",
	fullBleed = false,
}: SharedShellLayoutProps) {
	return (
		<Sidebar.Provider
			defaultOpen
			side={sidebarSide}
			style={
				{
					"--sidebar-bg": "var(--color-kumo-elevated)",
					height: "100svh",
					minHeight: "0",
					overflow: "hidden",
				} as React.CSSProperties
			}
		>
			{sidebar}
			<div className="flex flex-1 flex-col overflow-hidden">
				{header}
				{beforeMain}
				{/* Full-bleed clips because scrollIntoView() and focus() can still scroll
				    an overflow-hidden box, pushing the page up under the header. A
				    clipping box isn't a scroll container, so it also needs min-h-0. */}
				<main
					className={
						fullBleed
							? "min-h-0 flex-1 overflow-clip bg-kumo-elevated"
							: "flex-1 overflow-y-auto bg-kumo-elevated p-6"
					}
				>
					{children}
				</main>
			</div>
			{afterMain}
		</Sidebar.Provider>
	);
}

export interface SharedSidebarFrameProps {
	children: React.ReactNode;
	brand: React.ReactNode;
	footer?: React.ReactNode;
	ariaLabel: string;
	className?: string;
}

/** Shared Kumo sidebar frame. Navigation and identity are supplied by each host. */
export function SharedSidebarFrame({
	children,
	brand,
	footer,
	ariaLabel,
	className,
}: SharedSidebarFrameProps) {
	return (
		<Sidebar className={className} aria-label={ariaLabel}>
			<Sidebar.Header className="px-[11px] transition-[padding] duration-(--sidebar-animation-duration) motion-reduce:transition-none group-not-data-[state=collapsed]/sidebar:px-3.5">
				{brand}
			</Sidebar.Header>
			<Sidebar.Content>{children}</Sidebar.Content>
			<Sidebar.Footer className="gap-0">
				<Sidebar.Trigger className="rtl:rotate-180" />
				{footer}
			</Sidebar.Footer>
		</Sidebar>
	);
}

export interface SharedSidebarBrandProps {
	logoUrl?: string;
	siteName?: string;
	renderLink: (children: React.ReactNode, className: string) => React.ReactNode;
}

/** Shared brand treatment. Hosts provide only their router-appropriate link. */
export function SharedSidebarBrand({ logoUrl, siteName, renderLink }: SharedSidebarBrandProps) {
	return renderLink(
		<>
			<BrandIcon
				logoUrl={logoUrl}
				siteName={siteName}
				className="size-5 shrink-0"
				aria-hidden="true"
			/>
			<span className="grid min-w-0 flex-1 grid-cols-[1fr] transition-[grid-template-columns] duration-(--sidebar-animation-duration) ease-(--sidebar-easing) motion-reduce:transition-none group-data-[state=collapsed]/sidebar:grid-cols-[0fr]">
				<span className="min-w-0 overflow-hidden">
					<span className="block w-[calc(var(--sidebar-width)-4.5rem)] truncate font-semibold">
						{siteName || "EmDash"}
					</span>
				</span>
			</span>
		</>,
		"flex w-[calc(var(--sidebar-width)-1.75rem)] shrink-0 items-center gap-2 overflow-hidden py-1 ps-2.5 group-data-[state=collapsed]/sidebar:-translate-x-[3px] rtl:group-data-[state=collapsed]/sidebar:translate-x-[3px]",
	);
}

export interface SharedIdentityMenuProps {
	name?: string;
	email?: string;
	avatarUrl?: string;
	fallbackName: string;
	links?: (closeMenu: () => void) => React.ReactNode;
	logoutAction: React.ReactNode;
}

/** Shared identity popover. Identity data and host-specific actions are injected. */
export function SharedIdentityMenu({
	name,
	email,
	avatarUrl,
	fallbackName,
	links,
	logoutAction,
}: SharedIdentityMenuProps) {
	const [open, setOpen] = React.useState(false);
	const displayName = name || email || fallbackName;
	const initials = (name || email || "U")[0]?.toUpperCase() ?? "U";

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Popover.Trigger asChild>
				<Button variant="ghost" size="sm" className="gap-2" aria-label={displayName}>
					{avatarUrl ? (
						<img src={avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
					) : (
						<div className="flex h-5 w-5 items-center justify-center rounded-full bg-kumo-brand/10 text-[10px] font-medium">
							{initials}
						</div>
					)}
					<span className="hidden max-w-[120px] truncate sm:inline">{displayName}</span>
				</Button>
			</Popover.Trigger>
			<Popover.Content className="w-56 p-2" align="end">
				<div className="mb-1 border-b px-3 py-2">
					<div className="truncate font-medium">{name || email || fallbackName}</div>
					<div className="truncate text-xs text-kumo-subtle">{email}</div>
				</div>
				<div className="grid gap-1">
					{links?.(() => setOpen(false))}
					{links && <hr className="my-1" />}
					{logoutAction}
				</div>
			</Popover.Content>
		</Popover>
	);
}

export interface SharedHeaderPresentationProps {
	children: React.ReactNode;
}

/** Header geometry and mobile sidebar control, with host-provided actions. */
export function SharedHeaderPresentation({ children }: SharedHeaderPresentationProps) {
	return (
		<header className="sticky top-0 z-10 flex h-[58px] items-center justify-end border-b bg-kumo-elevated px-4">
			<Sidebar.Trigger className="me-auto cursor-pointer md:hidden rtl:rotate-180" />
			<div className="flex items-center gap-2">{children}</div>
		</header>
	);
}
