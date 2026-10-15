---
"create-emdash": major
---

Changes the default `npm create emdash@latest` project from a Cloudflare blog to a Node.js/PostgreSQL installation with a default site at `default.localhost` and Clerk-protected first-run setup at `localhost`.

The generated blog presentation lives under `src/default/`. Its Node host resolves the public site from a registered hostname. Before starting it, set `DATABASE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `CLERK_BOOTSTRAP_USER_ID` in the generated `.env`. Give the Clerk bootstrap user the backend-controlled `is_super_admin` metadata flag, and allow the local Clerk return URL described in the generated README.

Scripts that need the previous Cloudflare blog must pass `--template cloudflare:blog`. `--platform node`, `--template blog`, and `--template node:blog` now create the same multi-site/PostgreSQL installation as the default command. Node.js `starter`, `marketing`, and `portfolio` templates are not supported; use an explicit `cloudflare:` template prefix to keep creating those Cloudflare projects. Existing Node.js/SQLite scaffolding scripts must provision PostgreSQL and Clerk before running the new installation.
