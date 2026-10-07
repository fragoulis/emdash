# Domain docs

Before work in a domain, read `GLOSSARY.md` for shared terms. If `CONTEXT-MAP.md` exists, read it and then read the relevant context files it lists. Read relevant ADRs in `docs/adr/` and in the context's `docs/adr/` directory.

Use the terms defined in these files. If a proposed change conflicts with an ADR, state the conflict. Missing context files or ADRs do not block work; create them when a domain decision needs recording.

This repository uses multi-context layout. `CONTEXT-MAP.md` is the index; each entry identifies its context file and ADR directory. Package contexts normally use `packages/<package>/CONTEXT.md` and `packages/<package>/docs/adr/`. `GLOSSARY.md` serves as the shared root context.
