# Agent guidance

## Repository identity

This is the `emdash/emdash` fork with local customizations.

Track specs and tickets in GitHub Issues on `fragoulis/emdash`. See [issue-tracker guidance](docs/agents/issue-tracker.md). Use `GLOSSARY.md` for shared terms and `CONTEXT-MAP.md` for package contexts when present.

`CLAUDE.md` points here. `.agents/skills` and `.claude/skills` point to `skills/`. Do not sync these symlinks.

## External actions

Follow [AI_POLICY.md](AI_POLICY.md) for external actions and project communication.

Do not open design PRs or comment on issues, Discussions, or design PRs. On implementation PRs, post only a specifically requested code review or a reply to code review. Follow policy requirements for agent-written comments posted from a human account.

## Compatibility and migrations

EmDash is published and in active use on 1.x. Prefer additive changes. Breaking changes require an explicit decision, a major version bump, and a changeset that clearly calls out the break. When compatibility is unclear, stop and ask for a human decision.

Migrations are forward-only. Never make existing content inaccessible. Published migrations are immutable; add a new migration for corrections.

Before changing site ownership, request routing, settings, or central admin access, read [the multi-site hosting spec](docs/technical-specs/multi-site-hosting.md) and the relevant issue. The spec records the agreed target design, not a claim that all of it is implemented.

## Site identity

Site IDs have no implicit default. In a forward-only migration, backfill old site-owned rows to `site-default`, then require non-null `site_id` without a database or schema default.

New writes must supply the selected site ID explicitly. An unscoped write fails. When working on site ownership, correct old defaults only through new migrations and schema changes; never alter published migrations.

## Scope and safety

Keep work within the requested scope. Do not make drive-by refactors, bulk lint/type cleanups, or unrelated UI fixes. Report systemic and unrelated issues separately unless the operator authorizes the work.

A bug fix must show that it changes the reported behavior. Add a regression test when it protects stable, meaningful behavior; otherwise record reproduction and verification.

Protect logged-out route performance. Anonymous page query counts are the product's performance envelope. Any increase needs strong justification, including cold-start or first-request-only queries.

Keep credentials in local secret configuration only. Never put credentials or bootstrap IDs in generated files, logs, tests, or PRs.

## Choose task references

Read the matching implementation reference **before edits**:

- Core, API, database, schema, migration, or runtime work: [core implementation](docs/agents/core.md).
- Admin UI, localization, accessibility, or RTL work: [admin implementation](docs/agents/admin.md).
- Site-building, themes, schema, queries, or seeds: matching skill in `skills/`, usually `building-emdash-site`.
- Plugin authoring: `creating-plugins` skill.
- Public docs, contributor docs, specifications, release notes, or changesets: `writing-emdash-docs` skill.
- Agent instructions or skills: `writing-for-agents` skill.
- Other task types and generated-host work: [task routing](docs/agents/task-routing.md).

For judgment about meaningful tests, comments, compatibility, scope, and performance, read [review standards](docs/agents/review-standards.md). This document does not replace task-specific implementation requirements.

## Validation

Use [canonical validation](docs/agents/validation.md) for local checks and CI coverage. Choose tests relevant to changed behavior. Never run a full test suite locally. Do not run checks before editing to establish a baseline or label failures pre-existing.

Do not change a test only to make it pass. Understand the failure, preserve fail-closed boundaries, and correct production context or test fixtures.

For Markdown-only changes, use the Markdown procedure; do not run `pnpm` commands. Do not edit generated changelogs. Read [.changeset/README.md](.changeset/README.md) before adding a changeset.

## Multi-site local workflow

For multi-site installation work, follow [the local installation guide](infra/local-install/README.md). Use its persistent installation to inspect site-facing behavior and isolated check to verify generation and site isolation.

For requested generated-host browser reproduction, use the fixture-backed procedure in that guide. Generated hosts do not use the demo dev-bypass endpoints. Fixture-backed browser commands need no live Clerk credentials.

For multi-site scaffold, host, or Clerk work using a live Clerk account in a fresh worktree, first copy the operator's existing `.env` with mode 600. Require nonempty `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `CLERK_BOOTSTRAP_USER_ID`; the bootstrap ID identifies the existing development Clerk super admin. Check presence without printing values.

If a required value or source file is missing, ask the operator to supply it and stop until available. Keep `.env` untracked. CI uses local Clerk verification fixtures.

## Changes and delivery

Open PRs from the current working branch with all existing commits. Ask the operator before changing branches or excluding commits.

When opening an implementation PR with `gh` or the API, copy `.github/PULL_REQUEST_TEMPLATE.md` into the body and complete every section. The GitHub UI adds the template automatically. Check the AI disclosure box and name the model. Only tick checks actually verified.

Issues that refer to the interface must include a screenshot of the reported state. PRs that change UI must include before-and-after screenshots of every affected screen; for a new screen, the after state is enough. Use descriptive alt text and follow [CONTRIBUTING.md § Interface screenshots](CONTRIBUTING.md#interface-screenshots) for layout, cropping, and extra states.

Do not open design PRs. When preparing a design PR for a human, use `.github/PULL_REQUEST_TEMPLATE/design.md`. Follow [CONTRIBUTING.md](CONTRIBUTING.md) for contributor processes and [validation](docs/agents/validation.md) for checks.
