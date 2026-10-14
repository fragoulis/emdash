---
name: clean-up-ticket
description: Remove a ticket's local Herdr workspace, Git worktree, and branch.
disable-model-invocation: true
---

# Clean up a ticket

Require a ticket number. This procedure removes local resources only.

1. Check that the current checkout is on `main` and has no uncommitted changes. Switch to `main` if needed. Finish when `git branch --show-current` prints `main` and `git status --short` is empty.
2. Run `git down`. If it stops during a rebase, inspect `git status`, abort the rebase with `git rebase --abort` to restore `main`, and report that the update did not complete. Continue cleanup only after confirming the checkout is on a clean `main`. Stop for any other failure that leaves the checkout unclean.
3. Confirm `HERDR_ENV=1`, then find the Herdr workspace for `../emdash-ticket-{number}` with `herdr worktree list --cwd "$PWD"`. Confirm the workspace ID and path match the requested ticket. Run `herdr worktree remove --workspace <id>`. This removes both the Herdr workspace and its Git worktree. If no Herdr workspace exists but Git still lists the worktree, check that it is clean and run `git worktree remove ../emdash-ticket-{number}`. Finish when neither `herdr worktree list` nor `git worktree list` includes the path.
4. Run `git branch -d ticket-{number}`. If Git refuses because the branch is unmerged, stop and ask before using force. Finish when `git branch --list ticket-{number}` is empty.
5. Report the removed local resources and whether `git down` completed. Leave other ticket branches and remote branches unchanged.
