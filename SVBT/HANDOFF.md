# Operations handoff

## Current state

The application source and Render configuration are in this `SVBT/` directory. This change has not been deployed. Render, the live database, persistent storage, DNS, and the public site have not been accessed or changed.

The application maintains an internal ledger. It has no connection to core banking, payment settlement, or external bank rails. Ledger entries and generated statements should not be presented as proof that SVBT holds funds.

## Staff setup

Set `NODE_ENV=production`, `APP_ORIGIN` to the exact HTTPS origin, `MODERATOR_EMAIL`, and a unique `MODERATOR_PASSWORD` (12 or more characters) in the Render environment. Keep `DB_PATH` and `STATEMENT_DIR` on the persistent disk. Never put passwords in repository files. Run `npm run create-moderator` from the service shell to create the configured staff account.

Startup does not create customer users, accounts, ledgers, investments, or statements. `DEMO_SEED` and `SAMPLE_DATA` are no longer used. The owner-only ledger import is available only for accounts with no ledger entries and no prior import.

## Ledger uploads and transfers

Imports are previewed and reconciled before posting, and a successful upload is atomic and audited. Imported rows are marked as customer-provided, excluded from funds available for internal transfers, and cannot be reversed through the ordinary correction workflow. Statements containing imported records carry a fixed notice that they are not independently verified by SVBT. Owners should use the reviewed correction/import workflow for errors; do not edit imported transaction rows directly.

The six-digit transfer PIN, failed-attempt lockout, daily transfer limit, and owner-only access to uploads remain enabled. Transfers move ledger entries between SVBT accounts; they do not initiate an external payment.

## Preserve data before applying

1. Take and verify a consistent backup of the current database, statement PDFs, and uploads.
2. Confirm the active Render service uses this directory and that `DB_PATH` and `STATEMENT_DIR` resolve under its persistent disk. Do not point a populated service at a new empty disk.
3. Review the SQLite migration before applying it. It keeps existing users, accounts, transactions, imports, and issued statements; marks legacy imported/sample rows as customer-provided; and removes the obsolete demo account flag. It does not delete customer records. Any legacy sample users or rows that should not remain require a separately reviewed cleanup.
4. Deploy only after the backup, storage, and migration have been checked on the intended Render service. Verify health and data integrity afterward.

Existing issued PDFs and statement snapshots are immutable and are not rewritten by this change. The migration does not perform a public rollout or claim regulatory approval. The legal and compliance teams should review applicable disclosures and operating requirements.
