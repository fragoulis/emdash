# Fork scope

This document records the fork's support decisions. Read it before changing platform support, templates, development environments, CI, or upstream integration. Update it in the same change as any approved support-boundary change.

These are target decisions, not a claim that conversion is complete. Inventory existing workflows before removing them. Record unfinished work and coverage gaps in issues; keep this document focused on policy.

## Supported product

- Node.js and PostgreSQL are the only supported runtime and database combination.
- All maintained runnable projects use the multi-site host. An installation with one explicit site is valid; demos do not need a second site. Tests for cross-site isolation require distinct sites.
- Keep `blank`, `starter`, and `blog` as presentation starters for the shared host. Remove deployment-specific copies, marketing, and portfolio from the maintained template set.
- Use one persistent installation for daily development. It must support code updates, predictable seed/reset, public-page inspection, and admin work. Keep a separate application only for a demonstrated requirement the shared installation cannot meet clearly.
- Local development must work without live Clerk credentials. Use explicit local fixture identities with server-side verification; fixture mode must be unavailable in production. Keep an optional live Clerk verification workflow.
- Follow the multi-site hosting spec for product boundaries. Plugin authoring, comments, reader accounts, and unrelated project services are outside this development setup. Preserve an excluded service only for an explicit operational need.
- Leave unrelated packages intact unless removing a platform or obsolete workflow requires a change. This is not a general repository purge.

## Decide what is useful

Keep a capability only when it supports a named development, verification, or site-creation workflow within the supported product. Existing folders alone are not a reason to retain or convert projects.

Before removing a workflow, identify its relevant behavior and where that behavior will be exercised. Preserve content editing, authorization, query-budget, and other applicable behavioral coverage. Remove adapter-specific checks rather than mechanically converting them.

Keep simplification separate from completing missing multi-site features. Record blocked conversions and coverage gaps explicitly. Do not silently discard meaningful tests or claim equivalent coverage while their replacement is blocked.

## Upstream integration

Preserve upstream behavior within this fork's supported scope. Upstream integration cost is a design constraint, but correctness, explicit site context, and isolation take priority.

Classify affected capabilities when resolving an upstream change:

| Classification | Required action |
| --- | --- |
| Supported | Integrate upstream fixes and verify their PostgreSQL and multi-site behavior. |
| Intentionally removed | Preserve the removal. Do not restore unsupported choices or workflows during a rebase. |
| Retained but unsupported | Keep isolated upstream implementation only when it reduces recurring conflicts and adds no platform tooling requirement or installation, build, or testing burden. |
| Historical | Preserve published migrations and generated history. Update active guidance instead of erasing historical references. |

Remove Cloudflare and SQLite from supported CLI choices, development commands, templates, CI, and active documentation. Physical deletion of isolated adapter code is not required when it meets the retained-but-unsupported rule. Upstream additions do not automatically become supported.

Prefer small integration points and additive shared changes. Separate deletion commits from behavioral changes so replay and conflict review remain clear. Check clean merges for restored platform choices, implicit site defaults, and lost site isolation.

Published breaking changes require the explicit compatibility decision, major version bump, and changeset required by repository guidance. Published migrations remain immutable.

## Transition and validation

Policy approval does not remove existing checks by itself. Change validation instructions and CI alongside the workflows they replace. Document any coverage that cannot yet move to the supported host.

A passing SQLite or D1 run does not establish PostgreSQL coverage. Use real PostgreSQL for affected SQL and migrations, and the generated multi-site host for host behavior. Unsupported-platform checks are not release evidence for the supported product.

Use [canonical validation](validation.md) for the current implementation and the [multi-site hosting spec](../technical-specs/multi-site-hosting.md) for architecture. Use the [rebase skill](../../skills/emdash-rebase-onto-upstream/SKILL.md) for upstream integration procedure.
