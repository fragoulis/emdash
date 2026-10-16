---
"emdash": patch
---

Fixes starter seed taxonomy terms and bylines being reused across sites. Each site now gets its own terms, assignments, and bylines, and public term reads use the selected site. Existing terms and assignments are kept during the database upgrade.
