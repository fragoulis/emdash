export const clerkSignOutSource = `import { Button } from "@cloudflare/kumo";
import { useState } from "react";

export interface ClerkSignOutProps {
  publishableKey: string;
  label: string;
  errorLabel: string;
}

export function ClerkSignOut({ publishableKey, label, errorLabel }: ClerkSignOutProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function signOut() {
    setBusy(true);
    setError(false);
    try {
      const { Clerk } = await import("@clerk/clerk-js");
      const clerk = new Clerk(publishableKey);
      await clerk.load();
      await clerk.signOut(() => window.location.replace("/login"));
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <div>
      <Button type="button" onClick={() => void signOut()} disabled={busy}>
        {label}
      </Button>
      {error ? <p className="mt-3 text-kumo-danger" role="alert" dir="auto">{errorLabel}</p> : null}
    </div>
  );
}
`;

export const noAccessPageSource = `---
import adminStylesUrl from "@emdash-cms/admin/styles.css?url";
import { getLocaleDir, loadMessages, resolveLocale } from "@emdash-cms/admin/locales";
import { translateCentralAdminLabels } from "@emdash-cms/admin/locales/server";
import { ClerkSignOut } from "../components/ClerkSignOut.js";

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
    <title>{labels.noSiteAccessTitle}</title>
    <link rel="stylesheet" href={adminStylesUrl} />
  </head>
  <body class="min-h-screen bg-kumo-canvas text-kumo-default">
    <main class="mx-auto flex min-h-screen max-w-xl items-center justify-center p-6">
      <section class="w-full rounded-xl border border-kumo-line bg-kumo-base p-8 shadow-sm">
        <p class="mb-5 font-semibold text-kumo-brand" dir="ltr">EmDash</p>
        <h1 class="text-2xl font-semibold" dir="auto">{labels.noSiteAccess}</h1>
        <p class="mb-6 mt-3 text-kumo-subtle" dir="auto">{labels.noSiteDescription}</p>
        <ClerkSignOut client:load publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
          label={labels.signOut} errorLabel={labels.signOutError} />
      </section>
    </main>
  </body>
</html>
`;
