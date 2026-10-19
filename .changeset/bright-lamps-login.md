---
"create-emdash": patch
---

Fixes central admin sign-in in generated multi-site installations so `/login` serves the Clerk sign-in page, signed-out admin requests redirect there, and `/clerk-login` bookmarks continue to work. Clerk sign-in returns users to `/admin`.
