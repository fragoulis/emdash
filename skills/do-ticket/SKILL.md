---
name: do-ticket
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Create a fresh herdr worktree:

```bash
herdr worktree create --path ../emdash-ticket-{ticket-number} --branch ticket-{ticket-number} --no-focus
```

Use the /implement skill.

In the commit body, append `Closes #{ticket-number}.`

Push and open a PR using the /pr skill.
