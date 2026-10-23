---
name: emdash-rebase-onto-upstream
description: Rebase the EmDash multi-site fork onto upstream and verify both upstream and fork behavior.
disable-model-invocation: true
---

# Rebase EmDash onto upstream

Start or finish a rebase in the current worktree. Preserve upstream EmDash behavior and this fork's multi-site host changes. Keep this skill local to the fork; do not add it to the public skill sync list.

## 1. Establish the branch and recovery point

Read `git status`, `git remote -v`, and `git branch -vv`. Identify the fork branch and original project's remote from their actual URLs and history. The fork's `main` can contain multi-site changes; do not assume that `main` is pristine upstream or that fork work lives on `multi-tenancy`.

- **Active rebase:** read its metadata through `git rev-parse --git-path rebase-merge` or `rebase-apply`. Record the original branch, original tip, target commit, completed commands, remaining todo, and `REBASE_HEAD`. Continue the existing target. Ask before retargeting.
- **New rebase:** require a clean worktree. Fetch the confirmed upstream remote, identify its default branch, and resolve the target to a commit SHA. Record the current branch, fork tip, target, and merge base. Ask if the target or fork boundary is unclear.

Before advancing, create a uniquely named backup branch at the original fork tip. For an active rebase, use the original tip from rebase metadata, not the detached `HEAD`. Save the original fork and upstream lockfiles outside the worktree. Preserve unrelated user changes; do not stash, reset, skip, abort, or switch branches without approval.

Read [repository guidance](../../AGENTS.md), [task routing](../../docs/agents/task-routing.md), [canonical validation](../../docs/agents/validation.md), and the [multi-site hosting spec](../../docs/technical-specs/multi-site-hosting.md). Load implementation references for the files being merged. If instructions conflict, resolve the conflict before expanding scope. Report unrelated defects rather than adding them to the rebase.

For a new rebase, run `git rebase <target-sha>` only after the branch, target, fork boundary, and backup are known. Do not run baseline checks before edits.

## 2. Keep a merge and validation record

Create a temporary directory outside the worktree for logs and a Markdown record. Keep recovery SHAs, dependency-version decisions, and a conflict inventory there. Do not record credentials.

For each conflict, record:

| Commit and paths | Upstream behavior | Fork behavior | Merged behavior | Focused tests and dialects | Result |
| --- | --- | --- | --- | --- | --- |

Inspect cleanly merged adjacent code too. Conflict markers do not identify every integration defect. Include affected callers, cache keys, schema constraints, migrations, fixtures, and generated artifacts in the inventory.

Record each validation command, exit status, tested commit or working-tree state, and passed, failed, skipped, or unavailable coverage. Keep full command output in log files. Use summaries first; inspect bounded sections of large SQL snapshots or logs when needed. Preserve producer failures in pipelines with `set -o pipefail`.

## 3. Resolve and replay commits

At each stop, inspect `git show REBASE_HEAD` and `git diff --name-only --diff-filter=U`. For each unmerged path, compare `git show :1:path`, `:2:path`, and `:3:path`, plus the commits that introduced each behavior. During a rebase, stage 2 (`ours`) is upstream plus replayed commits; stage 3 (`theirs`) is the fork commit being replayed.

Resolve the behavior, not just the markers:

- Preserve upstream locale aliases, visibility checks, transactions, error propagation, export fences, resumability, and query budgets while adding site filters.
- Keep selected-site context explicit. Scope process-wide and distributed cache entries by site. Check request-cache readers and middleware together when changing keys or snapshot types.
- Match seed and repository upsert conflict targets to the actual site-scoped unique constraints. Test first seed, repeat seed, and the same logical names on two sites.
- Keep historical migration readers compatible with their pre-migration data and resume state. Do not substitute a current site-settings reader for a legacy reader. Use pre-migration databases for upgrade tests; keep published migrations immutable.
- Preserve both upstream UI behavior and fork shell integration, including hidden navigation items, identity fallback, and bidirectional text.

Update fixtures only after tracing the failure. Supply trusted site context and explicit site-owned row values where required. Keep negative tests for missing context. Do not relax production checks or remove assertions to make the replay pass.

Add a regression test when a deterministic interaction is not covered. If the two behaviors cannot coexist, ask for a decision. Do not choose an entire side just because it compiles.

Before continuing, review the staged diff and `git diff --check`. Stage only intended resolutions. Confirm `git ls-files -u` is empty, then run `GIT_EDITOR=true git rebase --continue`. Repeat until Git reports completion. Run cheap focused tests during replay when the intermediate commit supports them; reserve final workspace validation for the integrated tree.

## 4. Preserve dependency versions

When a lockfile conflicts, inspect both manifests and both lockfiles. Retain compatible exact versions already locked on either side. Use pnpm's supported lockfile merge or generation behavior; do not hand-edit generated lockfile entries or resolve the file wholesale to one side.

If generation is needed, use `pnpm install --lockfile-only --ignore-scripts` without an update operation. It can still select newer versions for missing entries. Compare the result with both saved lockfiles and review changed package versions, resolutions, peer variants, and workspace importers. Correct unintended upgrades before accepting the result. Ask before a dependency upgrade outside the integration scope.

Keep the reviewed merged lockfile through later commits. Regenerate only when a conflict or manifest change requires it, not on every replay. After the final manifests and lockfile agree, run a frozen install before package commands. Do not restore a whole historical lockfile late in validation without reviewing lost upstream entries and repeating affected checks.

## 5. Validate the integrated behavior

After the rebase, run the checks in [canonical validation](../../docs/agents/validation.md). Keep a current root workspace build for declaration consumers. Record which inputs invalidate it; reuse valid output between checks. If a required check fails, follow the documented rebuild-and-rerun procedure. Do not replace it with a package-only build.

Run a small integration smoke before expensive site or browser checks. Select existing focused tests for migrations, per-site settings and cache freshness, menu creation and repeat seeding, and site isolation. For each conflict inventory row, exercise both original behaviors and their interaction. Use the repository's real database helpers, not database mocks.

For changed PostgreSQL queries or migrations, arrange a disposable PostgreSQL database and set `EMDASH_TEST_PG` before running the relevant files. Read the PostgreSQL service configuration in `.github/workflows/ci.yml` and reuse existing disposable database setup where practical. Setting no connection string silently leaves dialect-wrapper tests SQLite-only. A successful SQLite run does not verify PostgreSQL SQL. Run relevant D1/workerd checks separately. If a required service is unavailable, record the exact unverified coverage and report the limitation; do not mark it passed.

For generated-host behavior, use the [local installation guide](../../infra/local-install/README.md) and its fixture-backed authentication. For visible UI changes, run relevant browser tests and Arabic checks as required by repository guidance.

When public query paths change, run the query-count tool. Regenerate snapshots through the tool only. Compare per-route cold and warm counts before reading individual SQL changes. Investigate increases instead of accepting them through a snapshot update.

Run only focused test files locally. Existing CI already provides broader lint, typecheck, PostgreSQL, seed, and browser coverage. Do not run the full suite or recreate the CI matrix. Keep failed or unavailable checks explicit. Do not commit unverified follow-up fixes as though validation were complete.

## 6. Review and deliver

Confirm the original branch is restored and no rebase metadata or unmerged paths remain. Verify the recorded upstream target is an ancestor with `git merge-base --is-ancestor <target-sha> HEAD`.

Compare the original fork series with the replay using `git range-diff <old-base>..<backup-ref> <target-sha>..HEAD`. Account for dropped, changed, or added commits against the merge record. Review changes since the backup for lost fork behavior and unintended dependency upgrades. A clean worktree and an ancestor check alone do not prove preservation.

Review the final diff against the conflict inventory. Treat preservation across modules as a review judgment; use existing lint, types, tests, and migration guards for mechanical checks. Keep validation-discovered integration fixes in focused conventional commits after their required checks pass. Report unrelated findings separately.

Report the branch and final SHA, upstream target, backup ref, integration fixes, successful checks, and skipped or unavailable coverage. State that the full suite was not run. Report any remaining worktree changes. Do not push without an explicit request; if later authorized to update rewritten remote history, use `--force-with-lease`, not `--force`.
