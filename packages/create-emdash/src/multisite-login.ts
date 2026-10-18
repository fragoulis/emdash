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

const clerkLocalizations = {
  ar: () => import("@clerk/localizations/ar-SA").then((module) => module.arSA),
  bn: () => import("@clerk/localizations/bn-IN").then((module) => module.bnIN),
  ca: () => import("@clerk/localizations/ca-ES").then((module) => module.caES),
  "zh-CN": () => import("@clerk/localizations/zh-CN").then((module) => module.zhCN),
  "zh-TW": () => import("@clerk/localizations/zh-TW").then((module) => module.zhTW),
  hr: () => import("@clerk/localizations/hr-HR").then((module) => module.hrHR),
  cs: () => import("@clerk/localizations/cs-CZ").then((module) => module.csCZ),
  da: () => import("@clerk/localizations/da-DK").then((module) => module.daDK),
  nl: () => import("@clerk/localizations/nl-NL").then((module) => module.nlNL),
  "en-GB": () => import("@clerk/localizations/en-GB").then((module) => module.enGB),
  fa: () => import("@clerk/localizations/fa-IR").then((module) => module.faIR),
  fr: () => import("@clerk/localizations/fr-FR").then((module) => module.frFR),
  de: () => import("@clerk/localizations/de-DE").then((module) => module.deDE),
  he: () => import("@clerk/localizations/he-IL").then((module) => module.heIL),
  hi: () => import("@clerk/localizations/hi-IN").then((module) => module.hiIN),
  hu: () => import("@clerk/localizations/hu-HU").then((module) => module.huHU),
  id: () => import("@clerk/localizations/id-ID").then((module) => module.idID),
  ja: () => import("@clerk/localizations/ja-JP").then((module) => module.jaJP),
  nb: () => import("@clerk/localizations/nb-NO").then((module) => module.nbNO),
  pl: () => import("@clerk/localizations/pl-PL").then((module) => module.plPL),
  "pt-BR": () => import("@clerk/localizations/pt-BR").then((module) => module.ptBR),
  "pt-PT": () => import("@clerk/localizations/pt-PT").then((module) => module.ptPT),
  "es-419": () => import("@clerk/localizations/es-ES").then((module) => module.esES),
  "es-ES": () => import("@clerk/localizations/es-ES").then((module) => module.esES),
  sv: () => import("@clerk/localizations/sv-SE").then((module) => module.svSE),
  th: () => import("@clerk/localizations/th-TH").then((module) => module.thTH),
  tr: () => import("@clerk/localizations/tr-TR").then((module) => module.trTR),
  uk: () => import("@clerk/localizations/uk-UA").then((module) => module.ukUA),
};

export function ClerkLogin({ publishableKey, locale, title, description, errorLabel }) {
  const signInRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const client = new Clerk(publishableKey);
    const node = signInRef.current;
    let active = true;
    let mounted = false;

    const loadLocalization = clerkLocalizations[locale]?.() ?? Promise.resolve(undefined);
    void Promise.all([loadClerkUI(client.frontendApi), loadLocalization])
      .then(([ClerkUI, localization]) => client.load({ ui: { ClerkUI }, localization })).then(() => {
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
      locale={locale} title={labels.signIn} description={labels.signInDescription} errorLabel={labels.signInError} />
  </body>
</html>
`;
