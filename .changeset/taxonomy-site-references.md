---
"emdash": patch
---

Fixes taxonomy term writes that accept a parent, translation, or assignment term from another site. Invalid term IDs now fail instead of creating a term under another site's parent or silently dropping an entry's existing assignments. Admin term translation reads and reorder requests also reject IDs from another site.
