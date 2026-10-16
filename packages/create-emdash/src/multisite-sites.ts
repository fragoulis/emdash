export const sitesPageSource = `---
import adminStylesUrl from "@emdash-cms/admin/styles.css?url";
import { getLocaleDir, loadMessages, resolveLocale } from "@emdash-cms/admin/locales";
import { translateCentralAdminLabels } from "@emdash-cms/admin/locales/server";
import { LinkButton } from "@cloudflare/kumo";
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
    <title>{labels.sites} - EmDash</title>
    <link rel="stylesheet" href={adminStylesUrl} />
  </head>
  <body class="min-h-screen bg-kumo-canvas text-kumo-default">
    <header class="flex items-center justify-between border-b border-kumo-line bg-kumo-base px-6 py-4">
      <span class="font-semibold">EmDash</span>
      <nav aria-label={labels.switchSite} class="flex flex-wrap items-center gap-3">
        {sites.map((site) => <LinkButton href={\`/site/\${encodeURIComponent(site.slug)}\`}
          variant={selected === site.slug ? "primary" : "secondary"}>{site.slug}</LinkButton>)}
      </nav>
    </header>
    <main class="mx-auto max-w-3xl p-6">
      <h1 class="text-2xl font-semibold">{selected || (sites.length ? labels.sites : labels.noSiteAccess)}</h1>
      {sites.length === 0 && <p class="mt-4 text-kumo-subtle">{labels.noSiteDescription}</p>}
      {!selected && sites.length > 0 && <ul class="mt-6 grid gap-3 sm:grid-cols-2">
        {sites.map((site) => <li class="rounded-xl border border-kumo-line bg-kumo-base p-4 shadow-sm">
          <LinkButton href={\`/site/\${encodeURIComponent(site.slug)}\`} variant="secondary">{site.slug}</LinkButton>
        </li>)}
      </ul>}
    </main>
  </body>
</html>
`;
