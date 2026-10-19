---
"create-emdash": patch
"@emdash-cms/admin": patch
---

Updates generated multi-site hosts to start with shared definitions and zero registered sites. Super admins sign in to System administration, where sites are registered explicitly with the `create-emdash site` CLI; verified staff without supported site access receive a dedicated no-access page with sign-out. Existing generated host files are not upgraded automatically.
