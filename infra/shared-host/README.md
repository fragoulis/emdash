# Two-build host proof

This proof loads two trusted Astro server builds in one Node process. Caddy forwards hostnames to the loopback origin, which resolves registered, active hostnames in PostgreSQL. Unknown hosts get HTTP 421. Each build reads a different greeting from one PostgreSQL database. The same asset URL serves a different file for each host.

Run from the repository root on Linux with Node, built workspace packages (`pnpm build`), pnpm dependencies installed, and Docker access:

```sh
node infra/shared-host/smoke.mjs
```

The smoke script starts disposable PostgreSQL and Caddy containers on the host network, builds the two presentations in `demos/postgres/proof/dist/`, starts one Node process, checks page and asset responses over HTTP through Caddy, then prints warm resident memory and stops all three services. It binds ports 18080 (Caddy), 18081 (Node), and 55432 (PostgreSQL) to loopback. Keep these ports free. The test does not need DNS or a local Caddy installation. Build output is ignored by Git.

## Baseline

On this Linux workstation, after both pages and assets had been requested through Caddy, `/proc/<pid>/status` reported Node `VmRSS: 101140 kB` and `/proc/1/status` inside the Caddy container reported `VmRSS: 51796 kB`. Node was v26.8.2; Caddy ran from `caddy:2-alpine`. These readings are a single warm sample, not a peak or a memory limit. They exclude PostgreSQL, the test runner, Docker overhead, and other processes. The Caddy measurement is process RSS, not container memory.

This is a host feasibility proof, not a multi-site EmDash release. The pages use direct PostgreSQL queries and EmDash's request context, but not EmDash's runtime or content schema. There is no site isolation, admin, staging, TLS, domain verification, or Clerk integration. The smoke script provisions two site identities and their hostnames in disposable PostgreSQL. The origin requires a proxy token and matching Host and X-Forwarded-Host headers; keep the token private and the origin bound to loopback. The proof does not run EmDash migrations or expose its admin and content APIs. Builds are trusted and installed by the operator, not uploaded by site admins. No ten-site memory claim follows from this two-build sample.

In the planned Node host, the host resolves each public hostname once and passes the site ID through server-side request context. Core does not look up the hostname again or choose a default site for requests without a resolved ID. Central admin selection is separate: it runs on the platform hostname and requires server-verified site access. The proof's rejection of `/_emdash` requests does not define the production admin interface. See [Multi-site hosting](../../docs/technical-specs/multi-site-hosting.md).
