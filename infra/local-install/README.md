# Local multi-site installation

Use this installation to test `create-emdash`, `create-emdash site`, and site-aware core behavior with real EmDash content. It runs explicit public sites at `foo.localhost` and `bar.localhost` through one Node host and one PostgreSQL database. The generated project and database state are local and ignored by Git.

## Set up and run

1. Install dependencies and build the workspace with `pnpm install --frozen-lockfile && pnpm build`. Start Docker. Provide a local root `.env` with nonempty `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `CLERK_BOOTSTRAP_USER_ID`. Keep these values local and do not commit them.
2. Run `bash infra/local-install/run.sh setup` from the repository root. This generates the project, starts its host to initialize shared definitions with zero sites, creates explicit `foo` and `bar` sites, checks public isolation, and builds the shared default presentation once. The first run takes longer than later reuse.
3. Run `bash infra/local-install/run.sh start`. Open `http://foo.localhost:4321/` and `http://bar.localhost:4321/`. The central admin is at `http://localhost:4321/`.

`setup` reuses the installation if its tracked source inputs have not changed. It refuses stale output when an input changes. Run `bash infra/local-install/run.sh reset` to delete the generated project and its disposable PostgreSQL container, then run `setup` again. Reset deletes any manual content changes in that installation.

## Capture authenticated browser evidence

Use a disposable generated host to capture the central admin without a live Clerk account. Install workspace dependencies, run `pnpm build`, start Docker, and install Chromium with `pnpm exec playwright install chromium`. Then run this command from the repository root:

```bash
pnpm browser:fixture --path /sites --output /tmp/emdash-evidence
```

The command generates and builds a fresh host, starts isolated PostgreSQL and a locally signed Clerk fixture, creates Foo and Bar sites, and opens an authenticated browser. It saves `page.png`, `page.aria.yml`, `capture.json`, `host.log`, and `browser.log` in the output directory. The browser, host, Clerk fixture, database container, and generated project are removed after capture, failure, or SIGINT/SIGTERM. Evidence remains. SIGKILL and machine shutdown cannot run cleanup.

Use `--locale ar` for Arabic or `--viewport 390x900` for a mobile viewport. Add `--interactive` to keep a visible authenticated browser open until you press Enter or close it. Interactive use requires a graphical display. The command renews its fixture cookie while the browser is open. Run `pnpm browser:fixture --help` for options. Each run replaces the evidence files in the selected output directory; omit `--output` to use a new temporary directory.

This command uses only local fixture credentials and does not load the root `.env`. It does not change the persistent installation used by `setup` and `start`. Use it for generated-host admin pages, not live Clerk sign-in or the single-site development bypass.

## Test site and admin behavior

Run `bash infra/local-install/run.sh check` for a fresh, isolated end-to-end check without changing the persistent installation. Build the workspace and install Chromium first. This check also tests browser capture, failed navigation, fixture token renewal, and cleanup after interruption. CI runs it from a clean checkout. The check uses a locally signed Clerk fixture and does not contact a live Clerk account.

For manual inspection, run `setup` and `start`, then visit both public hostnames and the central admin. The generated project is at `templates/.astro/local-install/site/`. Public requests use their registered hostnames; the client cannot select a site by ID. A super admin signs in and lands on System administration at `/sites`. The registry lists sites created by the CLI or admin, including disabled sites. It shows each site's status, domains, readiness, loaded presentation version, and latest installed version. A different latest version is marked as awaiting restart; only the loaded version serves requests. Builds publish to `dist/sites/<slug>/generations/<uuid>/` and atomically update `dist/sites/<slug>/version.json`. Published generations stay available to running hosts. Remove old generations only while the host is offline and no process can reference them. The admin has no restart or generation cleanup control. An unavailable presentation stays registered, shows an operator-facing explanation, and returns a generic public error rather than another site's page. Site management supports title edits with stale-write conflict handling. Open site admin stays disabled until site selection and membership enforcement are implemented in #10. Site membership management and ordinary staff access are not implemented.

The `src/default/` generated build folder contains shared admin and starter presentation source. It does not register a public default site. Setup and development-bypass endpoints are blocked on the generated multi-site host.

Initial setup removes remote featured images from the disposable seed to avoid network downloads. The site command seeds Foo and Bar from the starter seed through the shared site-creation operation. Both sites use the loaded default presentation. The check changes one Foo post and menu item to verify isolation. The persistent installation retains those database changes for inspection. Add new end-to-end assertions to `packages/create-emdash/tests/multisite-setup.test.ts` when they concern the generated host. Run only the relevant test file for core work that has its own test seam. Reset the persistent installation after changes to generator, template, core, admin, or lockfile inputs before trusting its rendered output.
