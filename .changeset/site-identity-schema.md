---
"emdash": minor
---

Adds site identity tables and required site ownership columns to PostgreSQL and SQLite databases. Sites have stable IDs and can have multiple hostnames. Existing collections, media, taxonomies, and settings are assigned to a default site during migration. Single-site writes continue to use the default site when no site ID is specified. Do not serve multiple sites through the EmDash admin or content APIs yet.
