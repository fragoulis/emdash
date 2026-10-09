# Shared host proof

This proof loads two trusted public Astro builds and one central EmDash admin client build in one Node process. Caddy forwards hostnames to the loopback origin, which resolves registered, active public hostnames in PostgreSQL. The admin hostname is configured separately with `PROOF_ADMIN_HOST`; it cannot select a public site. Each build has its own pages and assets under `site/src/{admin,foo,bar}/`. Unknown hosts get HTTP 421. Each public build reads a different greeting from one PostgreSQL database. The same asset URL serves a different file for each public host.

Run from the repository root on Linux with Node, built workspace packages (`pnpm build`), pnpm dependencies installed, and Docker access:

```sh
node infra/shared-host/smoke.mjs
```

The smoke script starts disposable PostgreSQL and Caddy containers on the host network, builds the two presentations and the Clerk sign-in page from `infra/shared-host/site/` into `infra/shared-host/site/dist/`, starts one Node process, checks page, asset, and signed-session responses over HTTP through Caddy, then prints warm resident memory and stops all three services. It binds ports 18080 (Caddy), 18081 (Node), and 55432 (PostgreSQL) to loopback. Keep these ports free. The test does not need DNS or a local Caddy installation. Build output is ignored by Git.

## Baseline

On this Linux workstation, after both pages and assets had been requested through Caddy, `/proc/<pid>/status` reported Node `VmRSS: 101140 kB` and `/proc/1/status` inside the Caddy container reported `VmRSS: 51796 kB`. Node was v26.8.2; Caddy ran from `caddy:2-alpine`. These readings are a single warm sample, not a peak or a memory limit. They exclude PostgreSQL, the test runner, Docker overhead, and other processes. The Caddy measurement is process RSS, not container memory.

This is a host feasibility proof, not a multi-site EmDash release. The public pages use direct PostgreSQL queries and EmDash's request context, but not EmDash's runtime or content schema. The admin build serves Clerk's sign-in component at `/_emdash/admin/login`; `/admin` redirects there. A verified Clerk session can open `/_emdash/admin/no-access`. The host maps the signed provider user ID to `proof_staff`, without using email or role claims. All admin-area APIs and other admin pages remain denied, including setup and legacy authentication. No admin-area request receives a public site ID, even if it supplies one in a query or header. Public hostnames cannot serve central routes. There is no staging, TLS, or domain verification.

For a persistent host, provision PostgreSQL and the two site registrations as the smoke script does, including `proof_staff`. Build each site from `infra/shared-host/site` with `PROOF_SITE=foo ../node_modules/.bin/astro build`, `PROOF_SITE=bar ../node_modules/.bin/astro build`, and `PROOF_SITE=admin PUBLIC_CLERK_PUBLISHABLE_KEY=<publishable-key> ../node_modules/.bin/astro build`. Configure the Clerk development instance to allow the admin origin. Start `node infra/shared-host/host.mjs` with `DATABASE_URL`, `PROOF_ADMIN_HOST`, `PROOF_ADMIN_ORIGIN` (the exact browser origin), `PROOF_CLERK_ISSUER` (the Clerk issuer URL), `CLERK_JWT_KEY` (Clerk's PEM JWT public key), `PROOF_PROXY_TOKEN` (a private random value), `PROOF_PORT`, and `ASTRO_NODE_AUTOSTART=disabled`. Run Caddy with `PROOF_PROXY_TOKEN` set to the same value and `infra/shared-host/Caddyfile`. Send requests to Caddy at the configured admin hostname. Never commit Clerk keys. Keep the admin API gate until membership authorization exists.

The origin requires a proxy token and matching Host and X-Forwarded-Host headers; keep the token private and the origin bound to loopback. Builds are trusted and installed by the operator, not uploaded by site admins. No ten-site memory claim follows from this sample. See [Multi-site hosting](../../docs/technical-specs/multi-site-hosting.md).
