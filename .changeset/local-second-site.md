---
"create-emdash": minor
---

Adds `npm create emdash@latest site [slug]` for an existing Node.js/PostgreSQL installation. After first-run setup, run it from the installation directory to register another local site with its own ID, starter content, settings, and presentation under `src/{slug}/`. The command prompts for a slug when omitted and leaves existing site files and seed data unchanged on repeat runs. Run `npm run build` and restart the Node host to serve the new site at `{slug}.localhost:4321` alongside the default site.
