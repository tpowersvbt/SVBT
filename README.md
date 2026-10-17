# Silicon Valley Bank and Trust

The current Render application is in [`SVBT/`](SVBT/). The root-level application files are a legacy copy; the root Render Blueprint sets `rootDir: SVBT` so Render builds the current application.

Read [`SVBT/HANDOFF.md`](SVBT/HANDOFF.md) before deployment. It covers the database migration, persistent storage, customer ledger uploads, and operational limitations.

This software maintains an internal ledger only. It does not connect to core banking, payment settlement, or external bank rails, and it does not certify that an institution is licensed or authorized to accept deposits. No deployment, domain change, or public rollout is performed by this repository change.
