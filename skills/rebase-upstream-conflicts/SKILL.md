---
name: rebase-upstream-conflicts
description: Resolve conflicts while rebasing EmDash fork commits onto upstream.
disable-model-invocation: true
---

# Rebase fork commits onto upstream

Resolve the conflict in the active worktree. Keep the upstream behavior and apply this fork's changes where its specifications and conventions require them. A clean merge marker count is not evidence that either behavior still works.

1. **Identify the replay.** Read `git status`, the rebase todo and the current commit (`git show REBASE_HEAD`). List every unmerged path. For each conflict, inspect the base (`git show :1:path`), upstream plus earlier replayed commits (`:2:path`), and the fork commit (`:3:path`). During a rebase, `ours` is stage 2 and `theirs` is stage 3. Compare the commits that introduced the competing behavior, not only the conflict markers. Check related specs, issues, migrations, tests, and call sites. Preserve unrelated staged changes.
2. **Resolve the behavior.** Write down the invariant from each side and how the merged code satisfies both. Keep upstream migration semantics for historical data; a later fork migration must not silently change an earlier upgrade. Scope new fork behavior to the selected site as required by `docs/technical-specs/multi-site-hosting.md`. Retain upstream transactions, failure propagation, resumability, and performance constraints when adapting their implementation. If the behaviors cannot coexist or the intended boundary is unclear, ask the user before editing. Do not choose a whole side merely because it compiles.
3. **Prove the integration.** Run focused tests for both sides of each conflict and add a regression test for a deterministic interaction. Update fixtures only after checking why they fail. Where a test needs legacy data, build a pre-migration database rather than bypassing new storage rules. Count skipped tests separately. Run the checks required by `AGENTS.md` after editing; run relevant dialect and workerd tests where available. Do not run the full test suite.
4. **Advance deliberately.** Review `git diff --check`, the staged diff, and `git ls-files -u`. Stage only intended paths, then `git rebase --continue`. Repeat for each new conflict until the rebase completes. Do not skip or abort a commit without the user's approval. Confirm the branch, working tree, and final commit log, then report what was preserved, which checks passed, and any unavailable checks.

A recurring conflict pattern is a legacy migration reader versus a later site-scoped settings reader. Keep the old migration's legacy key and resume state together. Test it on a database before the site-settings migration. Apply namespaced settings to normal site-context operations after that migration. Another pattern is site-scoped settings writes versus an upstream export fence. Keep the fence update inside the settings transaction and test rollback and no-op behavior under a selected-site context.
