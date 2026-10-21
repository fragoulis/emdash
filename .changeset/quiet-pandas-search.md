---
"emdash": minor
---

Adds native PostgreSQL full-text search with Greek stemming to the existing search and suggestion APIs. PostgreSQL chooses a text-search configuration from each content locale, indexes configured searchable fields and Portable Text, and applies configured field weights. SQLite keeps its existing FTS5 behavior.

PostgreSQL upgrades create indexes for enabled collections and existing content. Search queries, suggestions, statistics, and rebuild operations require trusted selected-site context; requests without it fail closed. Statistics and rebuilds are scoped to that site. Search enablement and searchable-field configuration remain shared collection settings.
