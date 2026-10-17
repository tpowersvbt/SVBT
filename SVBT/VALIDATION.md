# Validation

- `npm test`: 41 tests passed, including first-ledger-only imports, imported-record transfer/reversal safeguards, legacy database migration, and startup without seeded customer records.
- `npm run lint`: passed.
- `npm run build`: passed; tracked production assets were rebuilt.
- `npm ci`: installed the locked dependencies with no reported vulnerabilities.

The package declares Node 26.x, but this environment ran Node 22.23.3; npm reported the engine mismatch. Re-run CI on the declared Node version before deployment. The browser UI suite ran 2 of 4 tests successfully; the project-preview and statement-integrity UI assertions still fail and are not validated by the passing server tests.

No Render service, live database, persistent disk, DNS, or public site was accessed or changed. The application does not connect to core banking, payment settlement, or external bank rails. This validation is not a compliance or licensing approval.
