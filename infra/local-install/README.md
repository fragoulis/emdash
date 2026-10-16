# Local multi-site installation

Use this installation to test `create-emdash`, `create-emdash site`, and site-aware core behavior with real EmDash content. It runs two public sites, `default.localhost` and `foo.localhost`, through one Node host and one PostgreSQL database. The generated project and database state are local and ignored by Git.

## Set up and run

1. Install dependencies and build the workspace with `pnpm install --frozen-lockfile && pnpm build`. Start Docker. Provide a local root `.env` with nonempty `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `CLERK_BOOTSTRAP_USER_ID`. Do not commit these values.
2. Run `bash infra/local-install/run.sh setup` from the repository root. This copies the local blog template through the generator, sets up the default site, runs `create-emdash site foo`, checks public isolation, and builds both sites with the local Clerk configuration. The first run takes longer than later reuse.
3. Run `bash infra/local-install/run.sh start`. Open `http://default.localhost:4321/` and `http://foo.localhost:4321/`. The admin hostname is `http://localhost:4321/`. Protected admin routes beyond setup and sign-in are not yet enabled by the generated host.

`setup` reuses the installation if its tracked source inputs have not changed. It refuses stale output when an input changes. Run `bash infra/local-install/run.sh reset` to delete the generated project and its disposable PostgreSQL container, then run `setup` again. Reset deletes any manual content changes in that installation.

Run `bash infra/local-install/run.sh check` for a fresh, isolated end-to-end check without changing the persistent installation. CI runs this check from a clean checkout. The check uses a locally signed Clerk fixture and does not contact a live Clerk account. Initial setup removes remote featured images from the disposable seed to avoid network downloads. The site command seeds Foo from the starter seed, then the check changes one Foo post and menu item to verify isolation. The persistent installation retains those database changes for inspection.
