---
"create-emdash": patch
---

Fixes site rebuilds breaking requests handled by a running multi-site host. Builds now publish immutable generations, so lazy-loaded server chunks remain available until the host restarts. Existing site build metadata without a generation remains supported.
