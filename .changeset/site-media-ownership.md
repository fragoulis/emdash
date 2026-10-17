---
"emdash": major
"@emdash-cms/cloudflare": major
"@emdash-cms/sandbox-workerd": major
---

Requires a server-selected site for media repository and plugin media operations. Calls without trusted site context previously read or wrote installation-wide media; they now fail closed. Hosts and background jobs must supply the selected site through request context before calling media APIs. The Cloudflare plugin runner passes that site to its isolated bridge. Bridge bindings created directly must receive the trusted site ID from the host, not from plugin input.

The migration assigns existing media, folders, and upload attempts to `site-default` on PostgreSQL and SQLite, then removes implicit ownership defaults. New media writes must provide the selected site explicitly. New uploads use site-specific storage keys. Public media file and image URLs now require a ready media record on the resolved site, including for existing flat storage keys. Configure storage as private so direct bucket or CDN URLs cannot bypass this check. Public media links use the EmDash file route instead of a storage public URL. Multi-site plugin exposure remains disabled.
