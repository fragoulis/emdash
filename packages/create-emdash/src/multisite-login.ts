export const clerkLoginSource = `import { Clerk } from "@clerk/clerk-js";
import { LinkButton } from "@cloudflare/kumo";
import { useEffect } from "react";

export function ClerkLogin({ publishableKey, signInUrl, title, description, continueLabel }) {
  useEffect(() => {
    const client = new Clerk(publishableKey);
    void client.load().then(() => {
      if (client.user) window.location.replace("/admin");
    }).catch(() => {});
  }, [publishableKey]);

  return (
    <main className="min-h-screen bg-kumo-canvas text-kumo-default flex items-center justify-center p-6">
      <section className="w-full max-w-md rounded-xl border border-kumo-line bg-kumo-base p-8 shadow-sm">
        <p className="text-kumo-brand font-semibold mb-5" dir="ltr">EmDash</p>
        <h1 className="text-2xl font-semibold mb-3" dir="auto">{title}</h1>
        <p className="text-kumo-subtle mb-6" dir="auto">{description}</p>
        <LinkButton href={signInUrl} variant="primary" external><span dir="auto">{continueLabel}</span></LinkButton>
      </section>
    </main>
  );
}
`;

export const clerkLoginPageSource = `---
import adminStylesUrl from "@emdash-cms/admin/styles.css?url";
import { getLocaleDir, loadMessages, resolveLocale } from "@emdash-cms/admin/locales";
import { translateCentralAdminLabels } from "@emdash-cms/admin/locales/server";
import { signInUrl } from "../../../clerk.mjs";
import { ClerkLogin } from "../components/ClerkLogin.js";

export const prerender = false;
const locale = resolveLocale(Astro.request);
const labels = translateCentralAdminLabels(await loadMessages(locale));
const hostedSignIn = new URL(signInUrl);
hostedSignIn.searchParams.set("redirect_url", process.env.EMDASH_ADMIN_ORIGIN + "/admin");
Astro.response.headers.set("Cache-Control", "private, no-store");
---
<!doctype html>
<html lang={locale} dir={getLocaleDir(locale)} data-theme="classic">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{labels.signInTitle}</title>
    <link rel="stylesheet" href={adminStylesUrl} />
  </head>
  <body>
    <ClerkLogin client:load publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
      signInUrl={hostedSignIn.toString()} title={labels.signIn} description={labels.signInDescription}
      continueLabel={labels.continueToClerk} />
  </body>
</html>
`;
