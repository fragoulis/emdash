---
name: do-ticket
description: "Implement a piece of work based on a github ticket."
disable-model-invocation: true
---

Require the user to give a ticket number. Do nothing without a ticket number.

- {agent} is either `pi` or `codex`.

Start an agent in a fresh worktree:

```bash
created=$(herdr worktree create --path ../emdash-#{ticket-number} --branch ticket-{ticket-number} --no-focus)
pane=$(echo "$created" | jq -r '.result.root_pane.pane_id')
herdr agent start {agent}-#{ticket-number} --kind {agent} --pane "$pane"
```

Give the new agent the following prompt:

```
You are the orchestrator and planner. You do not make file changes.

- You spawn worker subagents that do the actual work and you control their lifecycle.
- The workers must use the model `gpt-6-luna`.
- You may use herdr to manage those worker subagents.

Example:

```bash
created=$(herdr workspace create --cwd "$PWD" --label 'emdash-#{ticket-number}-{brief}' --no-focus)
pane=$(printf '%s' "$created" | jq -r '.result.root_pane.pane_id')
herdr agent start {agent}-#{ticket-number}-{brief} --kind {agent} --pane "$pane" -- --model gpt-6-luna
```

Implement ticket #{ticket-number} using the `implement` skill.

1. Check the codebase. The ticket might be whole or partly implemented.
2. Grill me if you find gaps, contradictions and/or blockers.
3. Make a detailed plan describing all the steps to reach the goal.
4. Spawn a worker {agent} for each step, using the current worktree. You can spawn them sequentially or in parallel, if their work do not conflict.
5. Consider committing each step separately. In the commit body, append `Ref #{ticket-number}.`
6. Open a PR using the `pr` skill. In the PR description append `Closes #{ticket-number}`.

NOTE: Skills live at .agents/skills as well as at ~/.agents/skills.
```
