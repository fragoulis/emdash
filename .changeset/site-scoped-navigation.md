---
"emdash": minor
---

Adds site-scoped navigation menus for multi-site hosts. Two sites can use the same menu name and locale without sharing items, and public menu links resolve against the selected site's content. Existing menus and items move to `site-default` when the database migrates. Hosts must select a site on the server before reading or editing menus; direct SQL writers must supply `site_id` for both menus and items. Site import plans now record the selected site separately from the installation identity. Reanalyze any pending import made with an older plan before executing it; a plan without a selected site cannot run.
