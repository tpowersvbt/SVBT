# Silicon Valley Bank and Trust

The Render application is in this directory. Run commands here.

## Local development

```sh
npm ci
npm run dev
npm test
npm run lint
npm run build
```

No customer or staff accounts, ledgers, or statements are seeded at startup. Create staff access with `MODERATOR_EMAIL` and a unique `MODERATOR_PASSWORD` in the environment, then run `npm run create-moderator`. Never store credentials in this repository.

## Customer ledger uploads

An owner can preview and upload a customer's cash-book CSV only while the account has no ledger entries and no prior import. Every row must reconcile to the running balance, starting at zero. Uploads are atomic, recorded in the audit log, and limited to 256 KB and 2,000 rows.

Imported records are marked as customer-provided and are not independently verified by SVBT. They do not count as funds available for internal transfers and cannot be reversed through the ordinary correction workflow. Issued statements containing imported records carry a fixed notice that cannot be changed in the branding editor. The six-digit transfer PIN, lockout, daily limit, owner-only import access, and other existing controls remain in place.

## Operations and deployment

Back up the SQLite database and statement archive before applying migrations or changing Render storage. The migration retains existing accounts and ledger entries, marks previously imported/sample ledger rows as customer-provided, and removes the obsolete account flag; it does not delete customer records. Review and separately remove any legacy records that should not remain.

This application maintains an internal ledger. It does not connect to core banking, payment settlement, or external bank rails, and it is not certification of a regulated banking service. See [HANDOFF.md](HANDOFF.md) for deployment and data-preservation cautions.
