# SVBT ownership handoff

This guide covers the `ownership-handoff` branch of `tpowersvbt/SVBT`, Pull Request #2 into `tpowersvbt-powers-superhand`. Render deploys that branch, using `SVBT/` as its root directory.

**Status when this was written:**
- The PR is **not merged**. Nothing has been deployed.
- The live Render service, its settings and its database have **not** been touched.
- Every step below is something you (or your technical person) do when you're ready.

The change in one sentence: the site no longer depends on a seller-controlled login rebuilt from Render settings. **You** become the Owner, and you manage employees, customers, statements, investments and disclosures from Administration screens. All data lives on a permanent Render disk at `/var/data`.

The software is still an operations-review workspace. It holds sample records, moves no real funds, and claims no bank charter, deposit insurance or bank affiliation. The June–September 2026 statements remain clearly marked as samples.

---

## 1. What changed (files under `SVBT/`)

| File | What it does now |
| --- | --- |
| `server/paths.js` (new) | Decides where data lives. When `DATA_DIR` is set, everything goes there: the database (`bank.sqlite`), statement PDFs (`statements/`) and uploaded files (`uploads/`). |
| `server/permissions.js` (new) | One rulebook for who can do what. It defines four staff roles: Owner, Administrator, Moderator and Staff. Every screen and every server action checks it. |
| `server/accounts.js` (new) | Handles employees, customers and site settings. It also creates single-use password setup/reset links and handles statement PDF uploads with corrections. |
| `server/disclosures.js` (new) | Disclosure drafts, publishing, unpublishing and a permanent version history. |
| `server/mailer.js` (new) | Optional email delivery of password links through Resend. Without it, links are shown on screen for you to copy. |
| `server/promote-owner.js` (new) | The one-time command that makes your existing login the Owner (section 2). |
| `server/backup.js` (new) | `npm run backup`: a safe copy of the database plus statement and upload files, made while the site keeps running. |
| `server/db.js` | Database setup. On start it upgrades an existing database in place: it adds the new roles, password links, settings, uploaded statements, disclosures and public/private investment fields, and keeps every existing record. |
| `server/services.js` | Investment record rules: private draft, publish, unpublish, archive. Statement integrity checks still find PDFs after they move to `/var/data/statements`. |
| `server/index.js` | Server routes for all of the above, the customer statement pages, the public opportunities and disclosures, and the password-link pages. It warns in the logs when old settings are still present or `DATA_DIR` is missing. |
| `server/provision.js`, `server/create-moderator.js` (deleted) | These rebuilt the seller's moderator login from Render settings on every start. They are gone, so a setting change can no longer recreate or reset a staff login. |
| `src/Admin.jsx` (new) | The Employees, Customers (with statement files), Investments and Disclosures screens. |
| `src/Public.jsx` (new) | The public "Current opportunities" section, disclosure text, and the "Set your password" page. |
| `src/Portal.jsx` | The workspace shows tabs based on the signed-in person's role. Customers get a Statements tab and see the customer notice. Wording changed from "moderator" to "staff". |
| `src/App.jsx` | "Create workspace" is hidden when registration is closed. Password links open the "Set your password" page. The public opportunities section and footer disclosure links were added. "Moderator login" is renamed "Staff login". |
| `src/styles.css` | Small additions for checkboxes, the customer notice and the disclosure links. The existing design is otherwise unchanged. |
| `render.yaml` | Reference blueprint: `DATA_DIR=/var/data` on a 1 GB disk, optional `RESEND_API_KEY`/`EMAIL_FROM`, MODERATOR_* removed. (Render does not apply this file to an existing service automatically, so settings are changed in the dashboard; see section 3.) |
| `package.json` | Adds the `npm run promote-owner` and `npm run backup` commands. |
| `tests/ownership.test.js` (new), `tests/banking.test.js`, `tests/handoff.test.js`, `tests/ui/workspace.spec.js` | Automated checks for everything above (section 7). |
| `README.md` | Marked out of date, with a pointer to this file. |
| `HANDOFF.md` | This guide. |

**Not changed:**
- The design and branding.
- The leadership biography and the project publishing flow.
- Customer ledgers and issued statement PDFs.
- The old duplicate copy of the app at the repository root. Render uses `SVBT/`.

---

## 2. The one-time Owner command

Run this **once**, in the Render dashboard → the SVBT service → **Shell**, after the new code is live (step 6 in section 3):

```
cd /opt/render/project/src/SVBT && npm run promote-owner -- --email tpower@siliconvalleybankandtrust.com
```

**What it does:**
- Finds the existing login with that email and changes its role to **Owner**.
- Signs out that login's old sessions.
- Writes an entry in the audit log.
- Never creates users, never changes passwords and never deletes anything.
- Running it again just prints "No change needed".
- Expected output: `Done. User #… (t***@siliconvalleybankandtrust.com) changed from moderator to owner…`

After that, sign in with your **existing password** using **Staff login**. The Administration tabs appear.

**If it says "No user has that email address":** the old database was not moved onto the disk (steps 1–3 in section 3). Stop there and fix that first. As a last resort on a brand-new, empty database, create a workspace on the site with that email and run the command again. That fallback has not been tested end to end.

---

## 3. Going live: storage move and settings (in this order)

**Why the order matters:** Render erases the app folder on every redeploy unless a disk is attached. Based on the earlier check, the live database currently sits in that temporary folder (`/opt/render/project/src/SVBT/data/bank.sqlite`). Adding the disk itself triggers a redeploy, so take a copy **off the server first**.

Do this at a quiet time. Anything changed on the live site between step 1 and step 5 will not be carried over.

You'll need Magic Wormhole on your own computer, for example `pipx install magic-wormhole` (or `brew install magic-wormhole` on a Mac). Render's Shell already has it. Render's documentation describes it at https://render.com/docs/disks.

**0. Check where the data is now.** In the Render Shell:
```
cd /opt/render/project/src/SVBT && echo "DATA_DIR=$DATA_DIR DB_PATH=$DB_PATH STATEMENT_DIR=$STATEMENT_DIR" && ls -la data monthly/statements /var/data
```
- If `/var/data` already contains `bank.sqlite`, a disk is already in use. Skip to step 4.
- If `data/bank.sqlite` is missing and DB_PATH points somewhere else, use that path instead of `data/bank.sqlite` below.

**1. Take a copy off the server.** In the Render Shell. The copy is consistent even while the site runs.
```
cd /opt/render/project/src/SVBT
mkdir -p /tmp/svbt-move/statements
node -e "new (require('node:sqlite').DatabaseSync)('data/bank.sqlite').exec(\"VACUUM INTO '/tmp/svbt-move/bank.sqlite'\")"
cp monthly/statements/*.pdf /tmp/svbt-move/statements/
tar czf /tmp/svbt-move.tgz -C /tmp svbt-move
wormhole send /tmp/svbt-move.tgz
```
Then, on your computer, run `wormhole receive` and type the code it shows. **Keep this file safe.** It is your pre-migration restore point.

**2. Attach the disk.** In the Render dashboard → the service → **Disks**, add a disk:
- name `svbt-data`
- mount path `/var/data`
- 1 GB

Render requires a paid instance type for disks, and it redeploys when you save. The redeploy runs the current (old) code and resets the temporary app folder, which is why step 1 comes first.

**3. Put the copy on the disk.** In the Render Shell, after that redeploy is live:
```
cd /var/data
wormhole receive          # on your computer: wormhole send svbt-move.tgz, then type the code here
tar xzf svbt-move.tgz
mv -n svbt-move/bank.sqlite /var/data/bank.sqlite
mkdir -p statements && cp -n svbt-move/statements/*.pdf statements/
ls -la /var/data /var/data/statements
```
You should see `bank.sqlite` and the four `…-2026-06/07/08/09-r1.pdf` files. The old code does not use `/var/data`, so nothing has this file open yet.

**4. Environment settings.** In the Render dashboard → the service → **Environment**:

| Action | Setting | Value |
| --- | --- | --- |
| **Add** | `DATA_DIR` | `/var/data` |
| Keep | `APP_ORIGIN` | The exact `https://…` address of the site, with no trailing slash |
| Keep | `HOST` | `0.0.0.0` |
| Keep | `TRUST_PROXY` | `true` |
| Keep | `DEMO_SEED` | `false` |
| Keep | `SAMPLE_DATA` | `true`. It reuses the existing sample customer and statements and never downgrades the Owner. |
| Optional | `RESEND_API_KEY`, `EMAIL_FROM` | Only if you want password links emailed (section 6) |

The current code ignores `DATA_DIR`, so adding it now is harmless. **Do not delete the old settings yet** (step 8). They let a code rollback still sign in.

**5. Review and merge PR #2** into `tpowersvbt-powers-superhand`. Render builds (`npm ci && npm run build`) and starts the new code. On start it upgrades `/var/data/bank.sqlite` in place. This upgrade was tested on a copy of today's backup: users, transactions, statements and investments were kept, and it survived two restarts. The logs will say `Ignoring obsolete settings: …` until step 8. That is expected.

**6. Run the Owner command** from section 2.

**7. Check.** In this order:
1. `https://<your site>/api/health` shows `{"status":"ok"}`.
2. Sign in with Staff login and confirm the role badge reads "Server-verified Owner".
3. Open Customers and Statements, and download a June–September statement.
4. Restart the service from the dashboard and confirm everything is still there.
5. Run `npm run backup` (section 4).

**8. After a few good days, remove the obsolete settings:**
- `MODERATOR_EMAIL`, `MODERATOR_PASSWORD`, `MODERATOR_RESET`, `MODERATOR_NAME`, `MODERATOR_ADDRESS`
- `DEMO_MODERATOR_EMAIL`, `DEMO_MODERATOR_PASSWORD`
- `DB_PATH`, `STATEMENT_DIR`, `UPLOAD_DIR` (ignored once `DATA_DIR` is set)

Saving triggers a redeploy. Your data is on the disk and stays.

---

## 4. Backup, restore and rollback

**Make a backup.** It is safe while the site runs. In the Render Shell:
```
cd /opt/render/project/src/SVBT && npm run backup
```
It creates `/var/data/backups/svbt-<date-time>/`, containing `bank.sqlite`, `statements/` and `uploads/`.
- It checks the copy's integrity and prints how many users, transactions and statements it holds.
- It never overwrites or deletes anything.
- Do this before any change, and at least monthly.

**Take a backup off the server.** The disk is a single place, so copy backups off it:
```
cd /var/data/backups && tar czf /tmp/svbt-backup.tgz svbt-<date-time> && wormhole send /tmp/svbt-backup.tgz
```
On your computer, run `wormhole receive`. Once a backup is safely on your computer, you may delete older backup folders under `/var/data/backups` to save disk space. **Never delete `/var/data/bank.sqlite`.**

**Render disk snapshots.** Render also takes an automatic snapshot of the disk every 24 hours and keeps them for at least 7 days. You can restore the whole disk from the dashboard (Disks section), but everything after that snapshot is lost.

**Restore the database from a backup folder.** This was tested on a copy. In the Render Shell:
```
cd /var/data
B=before-restore-$(date +%Y%m%d%H%M%S) && mkdir $B && mv bank.sqlite* $B/
cp backups/svbt-<date-time>/bank.sqlite bank.sqlite
cp -n backups/svbt-<date-time>/statements/*.pdf statements/
```
Then **immediately restart the service** from the Render dashboard.
- The current database is moved aside into `before-restore-…`, not deleted.
- Anything done between the backup and the restore is not in the restored copy.
- To restore the pre-migration file from step 1, first send it to the Shell (`wormhole send` on your computer, `wormhole receive` in `/var/data`), then use it the same way.

**Roll back the code.**
- On GitHub, use **Revert** on the merged PR. Render redeploys the previous code. In the Render dashboard you can also pick an earlier deploy and choose **Rollback**.
- The old code does not read `DATA_DIR`. It goes back to the temporary app folder and the MODERATOR_* login. That's why step 8 waits.
- `/var/data` is left untouched, ready for when you roll forward again.
- Do **not** point the old code at the upgraded database (for example with `DB_PATH=/var/data/bank.sqlite`). That combination was not tested.

---

## 5. The Administration screens

Sign in with **Staff login** (top of the page) or **Staff access** (footer). The tabs you see depend on your role:

| Role | Can use |
| --- | --- |
| Owner | Everything, including appointing other Owners and Administrators |
| Administrator | Everything except managing Owners |
| Moderator | Customers and statements, Investments, Projects, Leadership bio, Audit |
| Staff | Customers and statements only |

The system never lets you remove or demote the last active Owner.

**Employees** (Owner, Administrator)
- *Invite an employee:* enter the full name, work email and role, then choose **Add employee and create setup link**.
  - If email is set up (section 6), the person gets the link by email.
  - If not, the link appears on screen. Choose **Copy link** and send it privately.
  - Setup links work once and expire after 72 hours.
- *Change role:* use the role menu on their row. They are signed out at once.
- *Deactivate / Reactivate:* deactivating signs them out everywhere and blocks sign-in. Nothing is deleted.
- *Password reset link:* creates a single-use link that expires after 2 hours. You never see or set anyone's password.

**Customers** (all staff roles)
- *Customer access and content* (Owner/Administrator can edit; others can only view):
  - **Allow people to create their own customer workspace online.** On by default. Turn it off to hide "Create workspace" and block self-registration.
  - **Let customers view and download their statements.** Off by default. Turn it on when you're ready.
  - **Notice shown to every signed-in customer.** Appears on each customer's Overview. Leave it empty for none.
  - Choose **Save customer settings**.
- *Add a customer:* enter the business/account name, email and address, then choose **Add customer and create setup link**. A unique 12-digit account number is created with a $0.00 balance, and a setup link is emailed or shown, as for employees.
- *Edit details* changes the name and address. The email and account number stay fixed.
- *Deactivate / Reactivate* and *Password reset link* work as for employees.
- *Statement files* uploads and corrects that customer's statements:
  - Choose the month and a title, pick a PDF (up to 10 MB) and an optional note, then choose **Upload statement**.
  - To fix a mistake, choose **Upload correction** on the current file. A note saying what was corrected is required. The original is kept, marked "Replaced", and stays downloadable. Customers only see the latest version.
- The **Statements** tab still shows the issued June–September sample statements for the selected account.

**Investments** (Owner, Administrator, Moderator)
- **Create record +** opens the form.
  - Choose a type: REIT, Land development, Data center, Startup technology or Other.
  - Public fields: title, summary, description and risk statement.
  - Private fields: internal sector name, status, target capital, strategy, and notes or document links.
  - **Save private draft** keeps the record private.
- **Preview & publish** shows exactly what the public will see. Private fields are never shown. **Publish publicly** needs a public title and summary.
  - The three existing records came over as private drafts **without** a public title or summary. Edit them first if you want to publish them.
- Edits to a published record stay private until you publish again. The row says "Unpublished changes saved" until then.
- **Unpublish** removes the record from the public site. **Archive** hides it everywhere but keeps it. **Show archived** and **Restore as draft** bring it back.
- Published records appear on the home page under **Current opportunities**, with the standard "not an offer / capital at risk" wording. The section is hidden when nothing is published.

**Disclosures** (Owner, Administrator)
- **New disclosure +**: write a title and text, leaving a blank line between paragraphs, then **Save private draft**.
- **Preview & publish** → **Publish disclosure**. It appears in the footer of every public page under "Disclosures", and as a link beside Current opportunities. Visitors see it after their page loads or refreshes.
- **Edit draft** changes the text privately until you publish again. **Unpublish** removes it from public pages.
- **Version history** keeps every published version permanently.
- Publish only statements that are true and verified. Don't describe regulatory status, insurance or bank affiliations unless they are.

**Projects** and **Leadership bio** (Owner, Administrator, Moderator): these work exactly as before, with private drafts and reviewed publishing.

**Audit** (Owner, Administrator, Moderator): a record of sign-in-relevant and administrative actions, including role changes, links issued, uploads, publishing and the Owner promotion.

**For customers:** customers see Overview (with your notice), Transactions, Statements (once you turn statements on), Account details and Profile. They see only their own account. Uploaded corrections show a "Corrected version" badge, and the sample statements show "Sample statement".

**"Set your password" page:** a link such as `https://<site>/#set-password=…` opens a page where the person chooses a password of at least 12 characters. The link then stops working, and the page takes them to sign in.

---

## 6. Things that still depend on outside accounts (seller or third party)

1. **GitHub.** The code lives in `tpowersvbt/SVBT` under the *personal* GitHub account `tpowersvbt`, and Render deploys branch `tpowersvbt-powers-superhand`.
   - Make sure the business controls that account, or create a GitHub organization the business owns, transfer the repository to it, and reconnect Render to the new location.
   - Review who has access under Settings → Collaborators, and remove anyone who shouldn't have it.
   - The Abacus.AI GitHub App was given access to make this PR. You can remove it at https://github.com/settings/installations, or adjust it at https://github.com/apps/abacusai/installations/select_target.
2. **Render.** Service `srv-db04iunavr4c73e4k0pg` holds the site, its settings, and (after section 3) the disk with all data.
   - Confirm the Render login, billing card and team members belong to the business.
   - If the service sits in someone else's Render account, ask Render support about moving it. Otherwise, recreate it in your own account from this repository and restore a backup (section 4).
3. **Email (optional): Resend.** To email password links automatically, create a Resend account owned by the business and verify your sending domain there. Then set `RESEND_API_KEY` and `EMAIL_FROM` (an address on that verified domain) in Render. Without them, everything still works: links are shown on screen to copy. Sending through Resend has **not** been tested.
4. **Domain and DNS.** Whoever registered the site's domain and the `siliconvalleybankandtrust.com` email domain controls where they point. Make sure the registrar and DNS logins are the business's. `APP_ORIGIN` must exactly match the address people use.

---

## 7. Test results

**Automated checks.** Run with Node 24 in `SVBT/`.
- `npm test`: **19 of 19 passed**. They cover:
  - roles and permissions, including last-Owner protection
  - employee and customer management, and single-use expiring password links
  - customer isolation, statement downloads only by their owner, and corrections that keep the original
  - investment and disclosure draft/publish/unpublish/archive with history
  - the old seller bootstrap being ignored
  - `DATA_DIR` paths
  - `npm run backup`
  - the original ledger, statement and security tests
  - the upgrade and Owner promotion on a **copy** of today's production backup (2 users, 52 transactions, 4 statements, 3 investments kept), followed by two restarts. The original backup file's checksum was unchanged.
- `npm run lint`: clean.
- `npm run build`: succeeded. The build output is not committed; Render builds it.

**Manual checks on copies.** None of these touched live data.
- Ran the section 3 move commands (VACUUM INTO, tar, unpack into a stand-in `/var/data`), then started the new code in production mode on that data:
  - health was OK
  - the obsolete-settings warning appeared
  - `promote-owner` changed moderator → owner and signed out 1 session
  - running it again printed "No change needed"
  - running it without an email failed safely
- Ran `npm run backup` while the server was running. It reported 2 users, 52 transactions and 4 statements, and refused cleanly when there was no database.
- Ran the restore steps, restarted, and the data was intact.

**Browser check.** Local development copy with demonstration data, run in this agent's browser.
- Promoted the demo login to Owner and signed in. All tabs showed.
- The Customers screen showed the settings and the customer list. Adding a customer produced a setup link.
- That customer opened the link, set a password and signed in. They saw only the customer tabs, and their Statements tab correctly said statements are not available yet.
- The Employees screen showed.
- The Investments screen showed the migrated drafts. Publishing was correctly blocked until a public title and summary exist.
- A disclosure was created, previewed and published. After a page refresh it appeared in the footer and opened correctly.

**Not run or not checked in a browser:**
- The Playwright UI test suite (`npm run test:ui`).
- Clicking through these screens in a browser: statement upload and correction, employee invite and role change, investment edit/publish/archive with a title, saving customer settings, and a customer's Statements tab with statements switched on. The server side of all of these is covered by the automated tests above.
- Real email delivery through Resend.
- Anything on the live Render service.

## 8. Limitations and notes

- This is an operations-review workspace with sample records. It moves no real money and is not connected to any core banking or payment system.
- Uploaded statement PDFs are stored in `/var/data/uploads`, with their checksums recorded in the database. Issued sample statement PDFs are also stored inside the database.
- Public pages pick up newly published items when a visitor loads or refreshes the page.
- Backups made with `npm run backup` live on the same disk until you copy them off (section 4).
- Older guides in this folder describe the previous setup and are superseded by this file: `README.md`, `DEPLOYMENT_GUIDE.md`, `QUICKSTART_RENDER.md`, `ONE_CLICK_DEPLOY.md` and `START_HERE_TIM.md`.
- The duplicate app at the repository root was not changed and is not used by Render.
