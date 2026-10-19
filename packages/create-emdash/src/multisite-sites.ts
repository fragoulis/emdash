export function createSitesPageSource(
	componentImport: "../components/ClerkSignOut.js" | "../../components/ClerkSignOut.js",
): string {
	return `---
import adminStylesUrl from "@emdash-cms/admin/styles.css?url";
import { getLocaleDir, loadMessages, resolveLocale } from "@emdash-cms/admin/locales";
import { translateCentralAdminLabels } from "@emdash-cms/admin/locales/server";
import { LinkButton } from "@cloudflare/kumo";
import { ClerkSignOut } from "${componentImport}";
import pg from "pg";

export const prerender = false;
const locale = resolveLocale(Astro.request);
const labels = translateCentralAdminLabels(await loadMessages(locale));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
let sites;
try {
  await db.connect();
  sites = (await db.query("SELECT slug FROM _emdash_sites WHERE active = 1 ORDER BY slug")).rows;
} finally {
  await db.end();
}
const selected = Astro.url.pathname.startsWith("/site/")
  ? Astro.url.pathname.slice("/site/".length) : null;
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
      <h1 class="mt-2 text-2xl font-semibold">{selected || labels.sites}</h1>
      {!selected && sites.length > 0 && <p class="mt-3 text-kumo-subtle" dir="auto">{labels.sitesDescription}</p>}
      {sites.length === 0 && <section class="mt-8 rounded-xl border border-kumo-line bg-kumo-base p-6">
        <h2 class="text-lg font-semibold">{labels.noSitesTitle}</h2>
        <p class="mt-2 text-kumo-subtle" dir="auto">{labels.noSitesDescription}</p>
      </section>}
      {!selected && sites.length > 0 && <ul class="mt-6 grid gap-3 sm:grid-cols-2">
        {sites.map((site) => <li class="rounded-xl border border-kumo-line bg-kumo-base p-4 shadow-sm">
          <LinkButton href={\`/site/\${encodeURIComponent(site.slug)}\`} variant="secondary">{site.slug}</LinkButton>
        </li>)}
      </ul>}
    </main>
  </body>
</html>
`;
}
