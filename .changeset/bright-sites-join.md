---
"emdash": minor
"create-emdash": minor
"@emdash-cms/admin": minor
---

Adds System administration site registry support for generated Node.js and PostgreSQL multi-site installations. Super admins can see every registered site, including disabled or unavailable sites, review domains and readiness, distinguish the loaded presentation from the latest installed version, and change a site's title with stale-edit protection and an audit record. Title updates keep exported site data consistent. Builds publish immutable presentation generations so a running host can continue loading its current assets; old generations remain until an operator removes them while the host is offline. Single-site installations and their public APIs are unchanged.

Existing generated multi-site host files are not upgraded automatically. Regenerate or update the generated host, build and readiness setup, and Astro configuration using the instructions in the generated project's README. Open site admin remains disabled until site selection and membership enforcement are available. This release adds no theme selection, deployment, restart, or generation-cleanup controls.
