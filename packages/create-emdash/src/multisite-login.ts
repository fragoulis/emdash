export const clerkLoginSource = `import { Clerk } from "@clerk/clerk-js";
import { useEffect, useRef, useState } from "react";
import type { ClerkUIConstructor } from "@clerk/shared/ui";

declare global {
  interface Window {
    __internal_ClerkUICtor?: ClerkUIConstructor;
  }
}

async function loadClerkUI(frontendApi: string): Promise<ClerkUIConstructor> {
  if (!window.__internal_ClerkUICtor) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = \`https://\${frontendApi}/npm/@clerk/ui@1/dist/ui.browser.js\`;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Clerk UI components"));
      document.head.appendChild(script);
    });
  }

  const clerkUI = window.__internal_ClerkUICtor;
  if (!clerkUI) throw new Error("Clerk UI components were unavailable after loading");
  return clerkUI;
}

export function ClerkLogin({ publishableKey, title, description, errorLabel }) {
  const signInRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const client = new Clerk(publishableKey);
    const node = signInRef.current;
    let active = true;
    let mounted = false;

    void loadClerkUI(client.frontendApi).then((ClerkUI) => client.load({ ui: { ClerkUI } })).then(() => {
      if (!active) return;
      if (client.user) {
        window.location.replace("/admin");
        return;
      }
      if (node) {
        client.mountSignIn(node, {
          forceRedirectUrl: "/admin",
          signUpForceRedirectUrl: "/admin",
        });
        mounted = true;
      }
    }).catch(() => {
      if (active) setError(true);
    });

    return () => {
      active = false;
      if (mounted && node) client.unmountSignIn(node);
    };
  }, [publishableKey]);

  return (
    <main className="min-h-screen bg-kumo-canvas text-kumo-default flex items-center justify-center p-6">
      <section className="w-full max-w-md rounded-xl border border-kumo-line bg-kumo-base p-8 shadow-sm">
        <p className="text-kumo-brand font-semibold mb-5" dir="ltr">EmDash</p>
        <h1 className="text-2xl font-semibold mb-3" dir="auto">{title}</h1>
        <p className="text-kumo-subtle mb-6" dir="auto">{description}</p>
        {error ? <p className="text-kumo-danger mb-4" role="alert" dir="auto">{errorLabel}</p> : null}
        <div ref={signInRef} />
      </section>
    </main>
  );
}
`;

export const clerkLoginPageSource = `---
import adminStylesUrl from "@emdash-cms/admin/styles.css?url";
import { getLocaleDir, loadMessages, resolveLocale } from "@emdash-cms/admin/locales";
import { translateCentralAdminLabels } from "@emdash-cms/admin/locales/server";
import { ClerkLogin } from "../components/ClerkLogin.js";

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
    <title>{labels.signInTitle}</title>
    <link rel="stylesheet" href={adminStylesUrl} />
  </head>
  <body>
    <ClerkLogin client:load publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
      title={labels.signIn} description={labels.signInDescription} errorLabel={labels.signInError} />
  </body>
</html>
`;
