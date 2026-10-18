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
herdr agent start {agent}-#{ticket-number} --kind {agemt} --pane "$pane"
```

Give the new agent the prompt:

```
Implement ticket #{ticket-number} using the `implement` skill.

Before starting the implementation:

1. Check the codebase. The ticket might be whole or partly implemented.
2. Grill me if you find gaps, contradictions and/or blockers.
3. Make a detailed plan describing all the steps to reach the goal.
4. Implement each step in a fresh {agemt} session using the model gpt-6-luna, herdr (subgent) in the current worktree. You control the lifecycle of these subagents.

```bash
created=$(herdr workspace create --cwd "$PWD" --label 'emdash-#{ticket-number}-{brief}' --no-focus)
pane=$(printf '%s' "$created" | jq -r '.result.root_pane.pane_id')
herdr agent start {agent}-#{ticket-number}-{brief} --kind {agemt} --pane "$pane" -- --model gpt-6-luna
```

5. Consider committing each step separately. In the commit body, append `Closes #{ticket-number}.`
6. Open a PR using the `pr` skill.
```
