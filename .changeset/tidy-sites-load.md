---
"create-emdash": minor
---

Adds build-version metadata and per-site presentation readiness loading to generated multi-site hosts. Sites with missing or invalid builds stay registered and return an unavailable response instead of preventing other sites from starting; replacing a build is reported as pending restart rather than replacing the handler already serving requests.
