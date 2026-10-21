# Issue tracker: GitHub

Specs and tickets live in GitHub Issues on `fragoulis/emdash`. Use the `gh-axi` skill for GitHub operations. Pass `-R fragoulis/emdash` to `gh` commands so the upstream remote cannot be selected by mistake.

Read GitHub issues for requirements and dependencies. Create or change issues only when specifically authorized by the operator and permitted by [AI_POLICY.md](../../AI_POLICY.md). Do not comment on or close issues as an automatic completion step. PRs are not a triage request surface.

For ticket-only interface work, use supplied screenshots. If screenshots are missing, request them instead of starting a browser environment, unless reproduction is explicitly requested. For requested reproduction on the generated multi-site host, use the [disposable browser command](../../infra/local-install/README.md#capture-authenticated-browser-evidence).

For task graphs, use GitHub issue dependencies. If dependencies are unavailable, put `Blocked by: #<number>` in the ticket body. A ticket is ready when all its blockers are closed.
