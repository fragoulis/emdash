export const multiSiteReadme = `# EmDash installation

This Node.js installation serves the default blog at \`default.localhost\` and keeps staff sign-in on \`localhost\`. PostgreSQL stores the site's content and the shared collection model.

- **Public site:** \`http://default.localhost:4321\` uses the presentation under \`src/default/\`.
- **Central setup:** \`http://localhost:4321/admin\` sends staff through Clerk before first-run setup.
- **Host:** \`host.mjs\` selects the site from the registered hostname. Requests cannot select a site with a header or query parameter.

## Get started

1. Create an empty PostgreSQL database and set \`DATABASE_URL\` in the generated, ignored \`.env\`. The scaffold already wrote a unique \`EMDASH_ENCRYPTION_KEY\` there.
2. Add \`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY\`, \`CLERK_SECRET_KEY\`, and \`CLERK_BOOTSTRAP_USER_ID\` to \`.env\`. Set \`{ "is_super_admin": true }\` in this Clerk user's public metadata from the Clerk dashboard or backend API. Configure the Clerk application to allow the return URL \`http://localhost:4321/clerk-login\`. Do not commit \`.env\`.
3. Install dependencies and start the local host. The development command builds the Astro presentation before starting Node; restart it after code changes.

\`\`\`sh
pnpm install
pnpm dev
\`\`\`

4. Open \`http://localhost:4321/admin\`, sign in with the configured Clerk user, and complete setup with the starter content selected. Read the seeded blog at \`http://default.localhost:4321\`.

## Add a local site

From the installation directory, run \`npm create emdash@latest site\` to choose a slug, or pass one as \`npm create emdash@latest site second\`. The command requires completed setup and a reachable PostgreSQL database. It registers \`second.localhost\`, copies the default presentation to \`src/second/\`, and seeds that site's content and settings without changing the shared collection definitions. It does not replace files or reapply seed data if you run it again.

Build both presentations and restart the Node host to make the new site available:

\`\`\`sh
npm run build
npm run start
\`\`\`

Open \`http://second.localhost:4321\`. To edit the presentation, change files under \`src/second/\`, then build and restart again. A build does not restart a running host.

Production uses \`pnpm build\` and \`pnpm start\`. Set \`EMDASH_ADMIN_HOST\`, \`EMDASH_DEFAULT_HOST\`, \`EMDASH_ADMIN_ORIGIN\`, and \`EMDASH_SITE_URL\` for deployed domains. Keep the Node origin bound to loopback. When a reverse proxy forwards requests, set \`EMDASH_PROXY_TOKEN\` on the host and send it as \`X-EmDash-Proxy-Token\` with a matching \`Host\` and \`X-Forwarded-Host\` from the proxy. Verify the custom domains and TLS before exposing the host.

The central admin's site-owned settings and content routes remain closed until site selection and membership enforcement are installed. Public pages and first-run setup remain available.
`;
