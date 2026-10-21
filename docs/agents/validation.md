# Validation

Use this procedure for local checks. CI runs the broader change-selected matrix described below. Read [AGENTS.md](../../AGENTS.md) for project safety rules and task-specific implementation references.

## Local checks

Before committing code or MDX changes:

1. Run `pnpm format`.
2. Run `pnpm build` from the repository root. Package builds alone do not refresh declarations used by other workspace packages.
3. Run `pnpm lint:quick` and confirm the lint JSON command exits successfully and reports zero diagnostics. Preserve pipeline failures with `set -o pipefail` before `pnpm --silent lint:json | jq '.diagnostics | length'`; a failed producer or `jq` command is a failed check, even if the printed count is zero.
4. Run only test files relevant to the changed behavior. Never run `pnpm test` or another full test suite locally. Record focused test commands and results.
5. Run `pnpm typecheck` for packages or `pnpm typecheck:demos` for Astro demos.
6. For MDX, docs configuration, or shared source consumed by the docs build, run `pnpm --dir docs build`.

For a generated multi-site installation, follow [the local installation guide](../../infra/local-install/README.md). For requested generated-host browser evidence, use its [fixture-backed browser procedure](../../infra/local-install/README.md#capture-authenticated-browser-evidence). Do not use a demo dev-bypass endpoint on a generated host.

For code or MDX changes, if a required check fails, refresh the root build and rerun it. Fix build, lint, typecheck, and relevant test failures before committing. For Markdown-only changes, fix the documentation issue and rerun the Markdown checks. Do not call a failure pre-existing. If validation reveals an unrelated problem, report it separately and keep it outside the change. State in the final report that full-suite tests were not run.

A human may approve deferring a specific failing test to a GitHub issue. Only then, skip that affected test, keep other relevant tests running, and record the issue and skipped test in the commit message and report. Never report a skipped test as passing.

## Markdown-only changes

Run `git diff --check`. Inspect changed links, anchors, frontmatter, and the full changed content. Do not run `pnpm` commands for Markdown-only changes.

## Code and MDX changes

Before opening a PR, code and MDX changes must be formatted and pass the applicable local checks above. For migration changes, also run the focused immutability tests and local base-present guard from [the enforcement inventory](enforcement.md). CI runs that guard for pull requests, pushes, and merge groups using each event's explicit base commit. It protects numbered migration modules present in that base, not all migration history. Add a user-facing changeset when a published package changes. Do not include extracted `messages.po` updates in non-translation changes.

For visible UI changes, capture screenshots of the rendered result. Include before-and-after screenshots when the result alone does not show the change clearly. Test all new admin UI in Arabic.

## CI coverage

CI selects checks from changed paths through `.github/scripts/test-plan.mjs`. Depending on the change, CI can run package and core tests, smoke and integration tests, D1/workerd tests, browser tests, Node and Cloudflare E2E, table E2E, and the generated multi-site installation. CI also runs build, typecheck, lint, template checks, and other repository checks in `.github/workflows/ci.yml`.

Local focused tests do not replace selected CI jobs. Do not reproduce the entire CI matrix locally. Review the PR checks selected for the change and address failures there. Run applicable generated-source, built-export, RTL geometry, and immutable-artifact checks when the changed files or behavior affect those surfaces. Treat CI's generated-skill sync, generated environment types, built exports, visual/admin RTL, and migration checks as applicable when their paths are selected.
