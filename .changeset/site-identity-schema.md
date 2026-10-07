---
"emdash": minor
---

Adds site identity tables and optional site ownership columns to PostgreSQL and SQLite databases. Sites can have stable IDs and multiple hostnames. Existing single-site data keeps its current behavior; the new ownership fields remain empty until site-scoped operations are available. Do not serve multiple sites through the EmDash admin or content APIs yet.
