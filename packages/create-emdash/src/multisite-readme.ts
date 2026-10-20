export const multiSiteReadme = `# EmDash installation

This Node.js installation starts with shared collection definitions and no registered sites. Public sites use explicit hostnames, such as \`foo.localhost\`; staff sign in at \`http://localhost:4321/admin\`.

## First startup

1. Create an empty PostgreSQL database and set \`DATABASE_URL\` in the generated, ignored \`.env\`. The scaffold writes a unique \`EMDASH_ENCRYPTION_KEY\` there.
2. Add \`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY\` and \`CLERK_SECRET_KEY\` to \`.env\`. Do not put credentials or a bootstrap user ID in generated files or commit \`.env\`. Configure Clerk to allow the return URL \`http://localhost:4321/admin\`.
3. Install dependencies and start the host. The host initializes the shared database definitions before it serves requests.

\`\`\`sh
pnpm install
pnpm dev
\`\`\`

4. Open \`http://localhost:4321/admin\` and sign in with a Clerk user whose current backend public metadata has \`is_super_admin: true\`. The admin opens System administration at \`/sites\`. The Sites list is empty until you register a site.

## Create a site

Keep the host running for its first initialization. From the installation directory, register a site with an explicit slug:

\`\`\`sh
npm create emdash@latest site foo
\`\`\`

The command creates the \`foo.localhost\` site, seeds its content and settings, and writes its presentation under \`src/foo/\`. Build the presentation and restart the host:

\`\`\`sh
npm run build
npm run start
\`\`\`

Open \`http://foo.localhost:4321\`. Repeat the site command with another explicit slug, such as \`bar\`, to add another site. The generated \`src/default/\` directory supplies shared admin and starter presentation files. It does not register a public site.

## Admin access

A verified super admin always lands on System administration at \`/sites\`. The site registry shows registered sites, including disabled sites, with their domains and presentation readiness. Readiness reports the loaded presentation version separately from the latest installed version. A newer installed version waits for a host restart before it serves requests. Builds publish to \`dist/sites/<slug>/generations/<uuid>/\` and atomically update \`dist/sites/<slug>/version.json\`. Published generations stay available to running hosts. Remove old generations only while the host is offline and no process can reference them. The admin has no restart or generation cleanup control. An unavailable presentation remains registered, includes an operator-facing explanation, and returns a generic public error instead of falling back to another site. Select a site with an explicit \`/site/<slug>\` URL to manage its display title. Title edits reject stale revisions; reload the latest value before saving again. Open site admin remains disabled until site selection and membership enforcement are available in #10. Ordinary verified staff without supported site access see \`/no-access\` and can sign out. Site membership management and ordinary staff access are not available in this generated host.

Setup and development-bypass endpoints are blocked on the generated host. Single-site installations outside this multi-site mode keep their existing setup flow. Existing generated multi-site project files are not upgraded automatically; regenerate or update the host files when adopting this behavior.

Production uses \`pnpm build\` and \`pnpm start\`. Set \`EMDASH_ADMIN_HOST\`, \`EMDASH_DEFAULT_HOST\`, \`EMDASH_ADMIN_ORIGIN\`, and \`EMDASH_SITE_URL\` for deployed domains. Keep the Node origin bound to loopback. When a reverse proxy forwards requests, set \`EMDASH_PROXY_TOKEN\` on the host and send it as \`X-EmDash-Proxy-Token\` with matching \`Host\` and \`X-Forwarded-Host\` headers from the proxy. Verify custom domains and TLS before exposing the host.
`;
