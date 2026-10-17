---
"emdash": major
"@emdash-cms/cloudflare": major
"@emdash-cms/sandbox-workerd": major
---

Requires a server-selected site for media repository and plugin media operations. Calls without trusted site context previously read or wrote installation-wide media; they now fail closed. Hosts and background jobs must supply the selected site through request context before calling media APIs. The Cloudflare plugin runner passes that site to its isolated bridge. Bridge bindings created directly must receive the trusted site ID from the host, not from plugin input.

The migration assigns existing media, folders, and upload attempts to `site-default` on PostgreSQL and SQLite, then removes implicit ownership defaults. New media writes must provide the selected site explicitly. This release does not enable multi-site plugin exposure or site-specific storage keys and public media serving.
