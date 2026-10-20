export function createSitesPageSource(
	componentImport: "../components/ClerkSignOut.js" | "../../components/ClerkSignOut.js",
): string {
	return `---
import adminStylesUrl from "@emdash-cms/admin/styles.css?url";
import { getLocaleDir, loadMessages, resolveLocale } from "@emdash-cms/admin/locales";
import { translateCentralAdminLabels } from "@emdash-cms/admin/locales/server";
import { LinkButton } from "@cloudflare/kumo";
import { ClerkSignOut } from "${componentImport}";
import { SystemSites } from "${componentImport.replace("ClerkSignOut", "SystemSites")}";

export const prerender = false;
const locale = resolveLocale(Astro.request);
const labels = translateCentralAdminLabels(await loadMessages(locale));
Astro.response.headers.set("Cache-Control", "private, no-store");
---
<!doctype html>
<html lang={locale} dir={getLocaleDir(locale)} data-theme="classic">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{labels.systemAdministration} - {labels.sites} - EmDash</title>
    <link rel="stylesheet" href={adminStylesUrl} />
  </head>
  <body class="min-h-screen bg-kumo-canvas text-kumo-default">
    <header class="border-b border-kumo-line bg-kumo-base py-4">
      <div class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6">
        <span class="font-semibold" dir="ltr">EmDash</span>
        <nav aria-label={labels.systemAdministration} class="flex flex-wrap items-center gap-3">
          <LinkButton href="/sites" variant="primary">{labels.sites}</LinkButton>
          <ClerkSignOut client:load publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
            label={labels.signOut} errorLabel={labels.signOutError} />
        </nav>
      </div>
    </header>
    <main class="mx-auto max-w-5xl p-6">
      <p class="text-sm font-semibold text-kumo-brand">{labels.systemAdministration}</p>
      <h1 class="mt-2 text-2xl font-semibold">{Astro.url.pathname.startsWith("/site/") ? <bdi dir="auto">{decodeURIComponent(Astro.url.pathname.slice("/site/".length))}</bdi> : labels.sites}</h1>
      <p class="mt-3 text-kumo-subtle">{labels.sitesDescription}</p>
      <div class="mt-6"><SystemSites client:load labels={labels} /></div>
    </main>
  </body>
</html>
`;
}
