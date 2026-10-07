---
"emdash": minor
---

Scopes published collection and entry reads to the request's site on PostgreSQL multi-site hosts. Two sites can publish the same slug and locale without returning each other's entries. Existing entries stay on the default site after migration, and single-site requests keep using that site without configuration changes.

Multi-site hosts must resolve a registered site before serving public pages. Routes for admin, editorial, and other site operations remain unavailable until those operations are isolated.
