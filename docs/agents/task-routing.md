# Task routing

Use the path for the work being changed. Apply [repository-wide safety rules](../../AGENTS.md) and use [canonical validation](validation.md) for every task.

| Work | Read before editing |
| --- | --- |
| Core, API, database, schema, migrations, runtime, imports, environment, or secret handling | [Core implementation](core.md) |
| Admin UI, localization, accessibility, RTL | [Admin implementation](admin.md) |
| Public docs, contributor docs, technical specifications | `writing-emdash-docs` skill; relevant docs style guide |
| Agent instructions or skills | `writing-for-agents` skill |
| Site themes, content queries, schema, seeds | `building-emdash-site` skill |
| Plugin authoring | `creating-plugins` skill |
| Multi-site installation or generated-host browser proof | [Local installation guide](../../infra/local-install/README.md); generated hosts use fixture-backed authentication, not demo bypass |
| Live Clerk work in a fresh worktree | Satisfy the secret prerequisite in [AGENTS.md](../../AGENTS.md) before editing or testing |

A documentation-only task uses Markdown checks in validation. Admin changes use the admin reference and relevant UI/RTL checks. Core or migration changes use the core reference, focused tests, and applicable migration/CI checks. Generated-host work uses its installation guide and fixture-auth workflow. Do not load unrelated implementation references.
