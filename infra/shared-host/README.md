# Shared host proof

This proof loads two trusted public Astro builds and one central EmDash admin client build in one Node process. Caddy forwards hostnames to the loopback origin, which resolves registered, active public hostnames in PostgreSQL. The platform hostname is configured separately with `PROOF_PLATFORM_HOST`; it cannot select a public site. Unknown hosts get HTTP 421. Each public build reads a different greeting from one PostgreSQL database. The same asset URL serves a different file for each public host.

Run from the repository root on Linux with Node, built workspace packages (`pnpm build`), pnpm dependencies installed, and Docker access:

```sh
node infra/shared-host/smoke.mjs
```

The smoke script starts disposable PostgreSQL and Caddy containers on the host network, builds the two presentations and the platform admin client from `infra/shared-host/site/` into `infra/shared-host/site/dist/`, starts one Node process, checks page and asset responses over HTTP through Caddy, then prints warm resident memory and stops all three services. It binds ports 18080 (Caddy), 18081 (Node), and 55432 (PostgreSQL) to loopback. Keep these ports free. The test does not need DNS or a local Caddy installation. Build output is ignored by Git.

## Baseline

On this Linux workstation, after both pages and assets had been requested through Caddy, `/proc/<pid>/status` reported Node `VmRSS: 101140 kB` and `/proc/1/status` inside the Caddy container reported `VmRSS: 51796 kB`. Node was v26.8.2; Caddy ran from `caddy:2-alpine`. These readings are a single warm sample, not a peak or a memory limit. They exclude PostgreSQL, the test runner, Docker overhead, and other processes. The Caddy measurement is process RSS, not container memory.

This is a host feasibility proof, not a multi-site EmDash release. The public pages use direct PostgreSQL queries and EmDash's request context, but not EmDash's runtime or content schema. The platform build serves the EmDash React admin client only at `/_emdash/admin/login`; `/admin` redirects there. Until Clerk verification and memberships are implemented, **all platform API requests and other admin pages are denied**, including setup and legacy authentication. The login client cannot complete sign-in yet. No platform request receives a public site ID, even if it supplies one in a query or header. Public hostnames cannot serve central routes. There is no staging, TLS, domain verification, or Clerk integration.

For #8 sign-in development, first run `node infra/shared-host/smoke.mjs` to check routing. For a persistent host, provision PostgreSQL and the two site registrations as the smoke script does, build each site with `PROOF_SITE=foo`, `PROOF_SITE=bar`, and `PROOF_SITE=platform` using `infra/shared-host/node_modules/.bin/astro build` from `infra/shared-host/site`, then start `node infra/shared-host/host.mjs` with `DATABASE_URL`, `PROOF_PLATFORM_HOST=platform.test`, `PROOF_PROXY_TOKEN` (a private random value), `PROOF_PORT=18081`, and `ASTRO_NODE_AUTOSTART=disabled`. Run Caddy with `PROOF_PROXY_TOKEN` set to the same value and `infra/shared-host/Caddyfile`. Send requests to Caddy on 127.0.0.1:18080 with `Host: platform.test`. Remove the platform API and admin gates only when server-side authentication and membership authorization are in place.

The origin requires a proxy token and matching Host and X-Forwarded-Host headers; keep the token private and the origin bound to loopback. Builds are trusted and installed by the operator, not uploaded by site admins. No ten-site memory claim follows from this sample. See [Multi-site hosting](../../docs/technical-specs/multi-site-hosting.md).
