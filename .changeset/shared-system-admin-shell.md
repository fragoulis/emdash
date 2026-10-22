---
"@emdash-cms/admin": minor
"create-emdash": patch
---

Adds shared system list and detail pages to newly generated multi-site hosts. The pages use the admin shell's theme, Sites navigation, and verified administrator identity menu. Hosts can use the exported `SystemAdminShell` from `@emdash-cms/admin/shared-shell` with a verified identity and sign-out action. Installing this release does not update source files in existing generated hosts.
