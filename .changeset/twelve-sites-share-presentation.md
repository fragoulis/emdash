---
"emdash": minor
"create-emdash": minor
"@emdash-cms/admin": minor
---

Adds title-and-slug site creation to System administration. New sites receive isolated starter data and use the loaded default presentation, so their generated hostnames serve immediately without a rebuild or restart. The `site [slug]` CLI command also uses the loaded default presentation and does not create per-site source files or build a separate presentation. Changes to the shared presentation source still require an operator build and host restart, and affect all sites using that default. Sites with dedicated presentation builds keep their existing behavior.
