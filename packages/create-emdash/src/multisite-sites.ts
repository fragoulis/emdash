export function createSitesPageSource(
	componentImport: "../components/ClerkSignOut.js" | "../../components/ClerkSignOut.js",
): string {
	return `---
import adminStylesUrl from "@emdash-cms/admin/styles.css?url";
import { getLocaleDir, loadMessages, resolveLocale } from "@emdash-cms/admin/locales";
import { translateCentralAdminLabels } from "@emdash-cms/admin/locales/server";
import { SystemAdministration } from "${componentImport.replace("ClerkSignOut", "SystemSites")}";

export const prerender = false;
const locale = resolveLocale(Astro.request);
const messages = await loadMessages(locale);
const labels = translateCentralAdminLabels(messages);
const siteSlug = Astro.url.pathname.startsWith("/site/")
  ? decodeURIComponent(Astro.url.pathname.slice("/site/".length))
  : "";
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
    <SystemAdministration client:load locale={locale} messages={messages} labels={labels} siteSlug={siteSlug}
      publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY} />
  </body>
</html>
`;
}
