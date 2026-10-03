# Existing Render service deployment

Target: svbt-rkqn (srv-db04iunavr4c73e4k0pg), master branch.
The separate svbt free service is not the intended deployment target.

## Before merging this repair

1. In the existing service's Dashboard, inspect Disks and Environment. The available MCP tools cannot inspect or attach disks. Do not create a second service.
2. Preserve any existing SQLite database with SQLite's backup API (including committed WAL contents) and preserve all statement archive files before triggering a deploy. Do not simply copy a live SQLite file without its WAL. Existing issued statements store archive paths: migrating archives requires preserving those paths or an explicit, tested migration; do not edit immutable statement rows.
3. If an existing persistent disk is present, retain its mount/path settings and adapt render.yaml to match. The proposed /var/data mount is for a clean installation, not an automatic migration. A new disk has no prior accounts or ledger.
4. For a clean installation, attach a 1 GB disk mounted at /var/data to the existing paid service. This has a recurring storage charge and causes a deployment/restart. Configure DB_PATH=/var/data/bank.sqlite and STATEMENT_DIR=/var/data/statements only after the disk exists.
5. Set NODE_ENV=production, DEMO_SEED=false, HOST=0.0.0.0, PORT=3000, TRUST_PROXY=true, APP_ORIGIN=https://siliconvalleybankandtrust.com and Node version 24. Keep the existing npm ci && npm run build build command and npm start start command. Set health check to /api/health.
6. Remove the repository's former default-password environment values. For a clean moderator, use the service Shell to run npm run create-moderator with MODERATOR_EMAIL and a unique MODERATOR_PASSWORD (12+ characters) supplied securely in environment variables. The existing script will not overwrite or promote an existing customer. Remove the password variable after provisioning. Do not reset an existing moderator unless required.
7. Merge the tested repair once data persistence and account provisioning are ready. Auto-deploy is enabled: do not also trigger a second deploy.
8. Verify Render reports live, GET /api/health returns 200, and login/logout works through the configured custom domain. Writes from other origins are rejected intentionally. Check recent app logs and verify data survives a controlled restart after backup.

## Changes

The previous startup path created accounts and then called seedDemo, which inserted those same email addresses and crashed with UNIQUE constraint failed: users.email.
Startup now seeds only when explicitly in demo mode, delegates account creation to seedDemo once, preserves idempotent statement creation, and rejects demo-seeded databases in production.
Origin checks require the configured exact origin and a present Origin on writes. Public demo passwords are no longer provisioned automatically in production.
The Blueprint uses persistent storage and removes its hard-coded moderator password.

The project remains the documented banking prototype; these deployment fixes do not turn it into a live banking system.
