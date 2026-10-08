---
"emdash": minor
"@emdash-cms/cloudflare": patch
"@emdash-cms/sandbox-workerd": patch
---

Adds site-scoped editorial content reads and writes for deployments that supply a trusted site context. Drafts, revisions, translations, bylines, and sandbox content operations use the selected site's entries. Existing single-site installations continue to use the default site without configuration changes.

Multi-site admin access remains blocked until site membership enforcement is available. A client-supplied site ID is not a trusted site context.
