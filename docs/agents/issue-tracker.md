# Issue tracker: GitHub

Specs and tickets live in GitHub Issues on `fragoulis/emdash`. Use the `gh-axi` skill for GitHub operations. Pass `-R fragoulis/emdash` to `gh` commands so the upstream remote cannot be selected by mistake.

Create, read, comment on, and close tickets as GitHub issues. Resolve a completed ticket by commenting with the result, then closing it. PRs are not a triage request surface.

For ticket-only interface work, use supplied screenshots. If screenshots are missing, request them instead of starting a browser environment, unless reproduction is explicitly requested. For requested reproduction on the generated multi-site host, use the [disposable browser command](../../infra/local-install/README.md#capture-authenticated-browser-evidence).

For task graphs, use GitHub issue dependencies. If dependencies are unavailable, put `Blocked by: #<number>` in the ticket body. A ticket is ready when all its blockers are closed.
