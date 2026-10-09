# Owner editing handover — 9 October 2026

Target service: `svbt-rkqn`; deployment branch: `tpowersvbt-powers-superhand`; root directory: `SVBT`.

The two new failed Blueprint services use the older `master` branch. They are not the live handover service.

## Changes

- The existing staff account `tpower@siliconvalleybankandtrust.com` is promoted to owner once on production startup. This does not create a public default password or change the account's password. If that email belongs to a customer, startup refuses promotion.
- Owners can add customer/staff accounts and assign customer, moderator, administrator or owner permissions. Role changes invalidate the affected user's sessions. Owners cannot demote themselves or remove the last owner.
- Owners and administrators can edit customer names, addresses and account numbers, and publish homepage copy, sector information and disclosures.
- Existing project, leadership, investment, transaction and statement tools remain available to staff.
- Public review/sample banners and workspace demo wording are removed. Previously issued statements and sample ledger records are not rewritten or deleted.
- Site content uses plain text, version checks and audit entries. It does not accept executable HTML.

## Before merging / deploying

Confirm that the currently used SQLite database and statement directory are on persistent storage, and take a consistent SQLite backup. The Render connector did not expose a disk in its service response, and its disk-event search returned no records. This does not prove a disk is absent, but persistence has not been verified. Do not change DB_PATH to a new empty directory or restart an ephemeral service until existing data has been safely backed up.

Merging into the deployment branch automatically redeploys the existing service. No extra Blueprint is needed.

## After deployment

1. Verify `/api/health` returns `ok`.
2. Sign out, then sign in through Staff login using Tim's existing password.
3. Confirm owner access and the Users & permissions, Site content and Customer details tabs.
4. Verify existing account records and issued statements remain present.
5. Review and publish the bank's final disclosure text and leadership biography using their editors.

Application owner access is separate from ownership of Render, GitHub and the domain registrar. Those account memberships are not changed by this patch.
