---
"emdash": minor
---

Adds `initializeMultisiteDatabase` at `emdash/internal/multisite/initialize` for PostgreSQL hosts that need to initialize migrations and shared seed definitions before serving requests. A fresh database finishes with no registered sites; site settings and sample data remain for explicit site creation. Existing databases keep their registered sites and data. Collection definitions are now shared records with nullable site ownership, while existing ownership values remain intact.
