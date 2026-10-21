# Core implementation guidance

Read this reference before changing core, API routes or handlers, databases, schemas, migrations, content queries, or runtime behavior. Follow [repository-wide safety guidance](../../AGENTS.md), [review standards](review-standards.md), and [canonical validation](validation.md).

## Architecture

EmDash is an Astro-native CMS for Cloudflare Workers and Node.js. `_emdash_collections` and `_emdash_fields` define schema; each collection has a typed SQL table (`ec_*`), not EAV. Middleware runs runtime initialization, setup checks, authentication, then request context. Authentication checks identity; routes enforce authorization. Handlers in `packages/core/src/api/handlers/` implement business logic and return `ApiResult<T>`. Routes are thin wrappers. Storage is accessed through `emdash.storage`.

Key files include `packages/core/src/emdash-runtime.ts` (runtime), `packages/core/src/schema/registry.ts` (content tables), `packages/core/src/database/migrations/runner.ts` (migration registration), and `packages/core/src/plugins/manager.ts` (plugins).

## API routes and authorization

Routes live in `packages/core/src/astro/routes/api/`; each starts with `export const prerender = false` and uses named `APIRoute` exports. File paths mirror URL paths, for example `content/[collection]/index.ts` for list/create and `[id].ts` for item actions. Access runtime through `locals.emdash` and the user through `locals.user`.

Use shared utilities, not local variants:

| Need | Use |
| --- | --- |
| Error response | `apiError(code, message, status)` from `#api/error.js` |
| Catch block | `handleError(error, message, code)`; never expose internal error messages |
| Body validation | `parseBody(request, zodSchema)` from `#api/parse.js`; do not cast `request.json()` |
| Handler result | `unwrapResult(result)` to map error codes to HTTP status |
| Initialization | `if (!emdash) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);` |

The error mapper is `mapErrorStatus`, not `mapErrorToStatus`. Never add a GET handler for a state-changing operation. Every state-changing route checks authorization. Authorization is permission-based, and `packages/auth/src/rbac.ts` is authoritative. Use `requirePerm` or `requireOwnerPerm`; define new permission strings in `rbac.ts` with a minimum role. State-changing requests require `X-EmDash-Request: 1`, enforced by auth middleware.

Handlers are standalone async functions, not class methods. Their first argument is `db: Kysely<Database>`, then route-specific params. Return `ApiResult<T>`, wrap work in try/catch, and return `{ success: false, error: { code, message } }` using `SCREAMING_SNAKE_CASE` codes.

List endpoints return `{ items, nextCursor? }`, never a bare array. Use `encodeCursor(orderValue, id)` and `decodeCursor(cursor)`. Default limit is 50, maximum is 100, and limits are clamped. Redirect inputs must start with `/`, reject `//`, be escaped before interpolation, and use `Response.redirect()` rather than meta refresh.

## Database and queries

Use Kysely. Parameterize values with tagged `sql`; use `sql.ref()` for identifiers. Never interpolate variables into `sql.raw()`. Validate dynamic identifiers with `validateIdentifier()` from `database/validate.ts`, including field names in `json_extract` paths.

```ts
await sql`SELECT * FROM ${sql.ref(table)} WHERE name = ${name}`.execute(db);
```

Content-table queries always filter by locale. Content is row-per-locale; slugs are unique by `(slug, locale)`. Treat locale display data as per-locale and identity as per-translation-group. Fetch translations through `GET /_emdash/api/content/{collection}/{id}/translations`.

Wrap stable query helpers in `requestCached`. Cache keys include every argument that affects the result; the promise is shared by concurrent callers. Module-scope singletons must use a `Symbol.for` key on `globalThis`, because Vite can duplicate modules across SSR chunks.

Prefer one joined or batched query over multiple round trips. Chunk `IN` parameters using `SQL_BATCH_SIZE` from `utils/chunks.ts`. Defer bookkeeping with `after()` and catch/log errors with a module-specific prefix. Do not add an empty-table probe round trip; handle missing tables with `isMissingTableError`. A probe folded into an already-running query adds no round trip. Review query-count snapshots; logged-out route increases, including first-request work, need explicit justification.

## Migrations and content schema

Migrations live in `packages/core/src/database/migrations/`, named `NNN_description.ts`, with `up(db: Kysely<unknown>)` and `down(db: Kysely<unknown>)`. Register each migration with a static import and in `StaticMigrationProvider` in `runner.ts`. Use Kysely schema builder for system tables and parameterized SQL with validated identifiers for `ec_*` tables. On SQLite use `text`, `integer`, `real`, and `blob`; booleans are integer, timestamps are text, and IDs are text ULIDs.

Published migrations are immutable. Add a monotonically increasing migration for corrections. Migrations must be retry-safe after any completed statement, especially on D1, where a lost response can leave an ambiguous outcome. Preserve expand/deploy/contract compatibility: old code tolerates expanded schema; new code tolerates incomplete backfills. When changing existing content tables, update `SchemaRegistry` so new tables match. Use portable dialect behavior, bounded batches, and index conventions.

Test representative existing data, retries after partial completion, every supported dialect, and realistic data sizes. Add a changeset for each affected published package.

Every content table has indexes for `status`, `slug`, `created_at`, `deleted_at`, partial `(deleted_at, scheduled_at)` where `scheduled_at IS NOT NULL`, `live_revision_id`, `draft_revision_id`, `author_id`, `primary_byline_id`, `updated_at`, `locale`, and `translation_group`. Index every foreign key. Use `idx_{table}_{column}` for single-column and `idx_{table}_{purpose}` for multi-column indexes.

`SchemaRegistry` in `schema/registry.ts` manages tables named `ec_{collection_slug}`; system tables use `_emdash_{name}`. Slugs match `/^[a-z][a-z0-9_]*$/`, are at most 63 characters, and are checked against reserved names. Standard columns include `id`, `slug`, `status`, `author_id`, timestamps, publication/scheduling/deletion fields, `version`, revision IDs, `locale`, and `translation_group`. Field columns are added with `ALTER TABLE`. `FIELD_TYPE_TO_COLUMN` in `schema/types.ts` maps field types. `discoverOrphanedTables()` finds `ec_*` tables without collection metadata.

## Site identity

Site-owned rows have no implicit site ID. Backfill existing rows to `site-default` in a forward-only migration, then make `site_id` non-null without a database or schema default. New writes supply the selected site ID explicitly; unscoped writes fail. Correct existing defaults only through new migrations and schema changes. Read the multi-site spec and relevant issue for ownership, request routing, settings, or central-admin changes.

When a test or resumed operation lacks site context, trace the trusted site ID through each step. Keep production boundaries fail-closed. Fix context propagation or the test fixture; never remove the context requirement or substitute an installation-wide ID. If the correct site ID is unknown, leave the change uncommitted.

## Tests

Use Vitest for package tests and Playwright for browser tests. Use real databases, not DB mocks. The default Node database driver is built-in SQLite. PostgreSQL parity is opt-in through `EMDASH_TEST_PG` and requires a role with `CREATEDB`; tests use isolated schemas.

Core tests live in `packages/core/tests/unit/`, `integration/`, and `workerd/`. `tests/utils/test-db.ts` exposes SQLite and PostgreSQL database helpers. For dialect-agnostic query code, use `setupForDialect`, `setupForDialectWithCollections`, `teardownForDialect`, and `describeEachDialect`. Read [validation](validation.md) for focused test selection and CI coverage. Never run the full suite locally.

## Imports and runtime environment

Use `.js` extensions for internal ESM imports; use `import type` for type-only imports. Package imports have no extension. Keep type and value exports separate in barrels. Virtual modules need the documented `@ts-ignore` directive.

Use `import.meta.env.DEV`/`PROD` for compile-time environment behavior, never `process.env.NODE_ENV`. Dev-only endpoints check `import.meta.env.DEV`. Read secrets only from `process.env`, never `import.meta.env`, which Vite can inline at build time. In Workers import bindings from `cloudflare:workers`; do not hand-type `Env`. Generate declarations with `pnpm wrangler types` when needed.

Local Wrangler development uses `.env`; if `.dev.vars` exists, Wrangler uses it instead and ignores `.env`. Production secrets use `wrangler secret put`. Keep local secrets untracked and out of generated scaffolds, tests, logs, and PRs.

## Comments

For comment judgment, use [review standards](review-standards.md). Keep implementation comments only when the code cannot be clearer or they explain a non-obvious invariant.
