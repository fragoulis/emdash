---
name: continue-ticket
description: "Continue the work you have already started on a github ticket."
disable-model-invocation: true
---

Require the user to give a ticket number. Do nothing without a ticket number.

/implement #{ticket-number}.

Before starting the implementation:

1. Check the ticket description for the savepoint.
1. Verify with the codebase what is missing.
1. Grill me if you find gaps, contradictions and/or blockers

In the commit body, append `Closes #{ticket-number}.`
