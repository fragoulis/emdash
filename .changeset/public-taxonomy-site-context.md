---
"emdash": patch
---

Fixes public taxonomy reads with no selected site returning empty results for unknown terms or empty entry batches. These reads now reject the request instead of treating missing site context as an empty site.
