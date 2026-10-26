# Tallyroom — Simple Business Finance Tracker

Tallyroom is a small, single-owner class project with login, income/expense CRUD, predefined categories, date/category/type filters, description search, all-time and filtered totals, CSV export, pagination, duplication, basic inventory management, and database backup/restore.

Repository: https://github.com/FwDubbb/CSC-470-SME-PROJECT

## Setup

Install **Node.js 24.10 or later**. No third-party packages, database service, or build step are needed.

```sh
git clone https://github.com/FwDubbb/CSC-470-SME-PROJECT.git
cd CSC-470-SME-PROJECT
npm run dev
```

Open **http://localhost:3000**. On first launch, choose a username and password using **Create account** in the browser. You are signed in automatically. Once the owner exists, this screen becomes **Sign in**, and additional account creation is blocked.

Choose a username of 3-40 letters/digits/dots/underscores/hyphens and a unique password of 15-128 characters. No default password is shipped. Stop with Ctrl+C. The dev command enables server auto-restart; npm start runs without watching files. Node 24.10 may print an experimental SQLite warning.

Existing finance databases retain their records. If no owner has been created, the first-run form appears; otherwise use your existing login. Browser signup is available on local loopback installations only. Hosted/production installations use npm run account:setup on the server before deployment. The terminal command remains available as an optional local setup method.

## Usage

- Record income or expenses with an amount, date, category, and optional description (250 characters maximum).
- Edit, cancel unsaved edits, or delete after confirmation. Deletion is permanent.
- Duplicate fills the form for review; saving creates a new transaction. Review its date before saving.
- Combine type, category, inclusive start/end dates, and description search. Search treats `%` and `_` literally and is case-insensitive for basic Latin text.
- Use This month, Last month, This year, or custom dates. Clear filters resets the selection.
- Main cards show **all-time totals**. Matching-record totals use **all active filters across every page**.
- Choose 20, 50, or 100 records per page. Export CSV downloads every matching record, including other pages.
- Change password from the header with your current password. This revokes all sessions. Sign out revokes the current session and clears displayed records.

Income categories: Sales, Services, Other Income. Expense categories: Rent, Utilities, Supplies, Transportation, Other Expenses. Categories remain predefined.

Amounts are USD, stored as integer cents, and must be between $0.01 and $9,999,999.99 per transaction. Dates may be past or future; future entries count immediately. Balance is recorded income minus expenses, without bank integration or an opening balance feature.

## Basic inventory

Use the Inventory link to add items with a name, quantity in stock, and unit price in USD. Search by name, edit to update stock or price, and delete after confirmation. Zero quantity is marked Out of stock. Item names are unique without regard to letter case. Quantities are whole numbers from 0 to 1,000,000; prices can be zero and allow at most two decimal places.

Inventory is intentionally manual: stock changes do not create financial transactions, and income entries do not reduce stock. There are no suppliers, purchase orders, automatic sales processing, stock-movement history, or additional inventory reports. Inventory requires login and shares the existing database and backups. Older finance-only backups restore successfully with an empty inventory list.

## Password recovery

Stop the server and run:

```sh
npm run account:reset
```

Choose the owner username and new password. Finance data stays intact and all sessions are revoked. Recovery requires local machine access; there is no email recovery or multiple-user system.

## Backup and restore

Stop the server first. Database locking prevents maintenance during normal server operation.

```sh
npm run backup
npm run restore -- "C:/path/to/finance-backup.sqlite"
```

Backup creates a consistent snapshot under `data/backups/` and prints its path. Copy it to a private safe location. Backups contain financial information and password hashes.

Restore validates SQLite integrity, expected finance columns, and foreign keys before staging a replacement. It saves the current database as a **before-restore** backup, replaces the active database, and revokes restored sessions. Use only trusted backups. Sign in with the credentials in the backup, or reset the owner locally. Older finance backups without auth tables are supported; run account setup afterward.

Database files, backups, locks, and browser screenshots are ignored by Git. Cloning GitHub retrieves source code, not your financial records.

## Security

- Asynchronous **scrypt** password hashing: random 16-byte salt, N=131072, r=8, p=1, 64-byte derived key. Passwords are never stored as plaintext. Hash comparisons use `timingSafeEqual`.
- Random 256-bit session tokens; SQLite stores their SHA-256 hashes. Cookies use **HttpOnly**, **SameSite=Strict**, and **Secure** in production.
- Sessions expire after 30 minutes idle or 12 hours total, survive restarts until expiry, and rotate on login. Logout invalidates the current session; password change/reset revokes all sessions.
- Authenticated mutations require a session-specific CSRF token. Cross-origin browser writes are rejected. Tokens stay in browser memory rather than localStorage.
- Five login attempts per source address within 15 minutes trigger a temporary block, persisted across restarts. Password-verification concurrency is bounded. Unknown users and incorrect passwords receive the same error.
- All finance endpoints, including CSV downloads, require authentication.
- Parameterized SQL, server input validation, safe text rendering, Content Security Policy, frame blocking, no-store caching, body limits, and request timeouts add protection.
- CSV text is escaped and formula-like values are prefixed against spreadsheet formula execution. Some spreadsheet applications may display the prefix.

This is a local class application, not an independently audited security product. Authentication does not encrypt SQLite or backups; filesystem access can bypass application controls. MFA, multiple users, email recovery, and distributed rate limiting are outside scope.

The server binds to loopback. For deployment behind an HTTPS reverse proxy, set `NODE_ENV=production` and `APP_ORIGIN=https://your-host`. Production requires an HTTPS origin and enables Secure cookies and HSTS; TLS termination belongs to the proxy. Do not expose plain HTTP publicly. Hosting is not configured by this repository.

References: [Node crypto](https://nodejs.org/api/crypto.html), [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | Project's `data/finance.sqlite` | Database for server and maintenance |
| `NODE_ENV` | unset | `production` enables secure-cookie requirements |
| `APP_ORIGIN` | Current local host | Exact origin; HTTPS required in production |
| `BROWSER_PATH` | Installed Chrome/Edge on Windows | Browser for optional UI checks |

Relative `DB_PATH` values resolve from the shell directory. Set it consistently for every command. PowerShell example:

```powershell
$env:PORT = '3001'
npm start
```

## Structure and database

```text
public/     Interface, styles, browser JavaScript
server/     HTTP API, SQLite, auth, queries, database locking
scripts/    Owner setup/reset, backup/restore, browser checks
test/       Finance and security integration tests
data/       Ignored local database and backups
```

The two finance tables remain `categories(id,name,type)` and `transactions(id,type,amount_cents,date,category_id,description)`. A composite foreign key enforces category/type consistency. A single `inventory(id,name,quantity,unit_price_cents)` table stores stock. Authentication adds `users` (one owner), `sessions`, and `login_limits`, without duplicating finance tables.

## Tests

```sh
npm test
npm run test:browser
```

API tests use temporary databases and cover CRUD, filters, cents arithmetic, validation, persistence, migration, hashing, protected APIs, throttling, CSRF, session rotation/expiry/revocation, password changes, production cookie flags, CSV, pagination, backups, restore, and locking.

Optional browser checks require installed Chrome/Edge (or `BROWSER_PATH`). They use a temporary database/profile and check desktop/mobile workflows, writing ignored screenshots under `artifacts/`. They never access your real financial database. Browser checks are separate from the portable API suite.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/auth/status` | Setup status/current session |
| POST | `/api/auth/signup` | Create the first owner locally and sign in |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | Revoke session |
| POST | `/api/auth/password` | Change password/revoke sessions |
| GET | `/api/inventory` | List inventory items |
| POST | `/api/inventory` | Add an item |
| PUT | `/api/inventory/:id` | Update an item |
| DELETE | `/api/inventory/:id` | Delete an item |
| GET | `/api/categories` | Fixed categories |
| GET | `/api/transactions` | Paginated history |
| POST | `/api/transactions` | Create |
| PUT | `/api/transactions/:id` | Update |
| DELETE | `/api/transactions/:id` | Delete |
| GET | `/api/summary` | `{allTime,filtered}` cent totals |
| GET | `/api/export` | Filtered CSV |

History, summary, and export accept `type`, `category`, `start`, `end`, and `search`. History also accepts `page` and `pageSize` (1–100), returning `{items,total,page,pageSize}`. Protected writes require the session cookie and `X-CSRF-Token` from login/status. First-run signup uses `{username,password,confirmPassword}`. Login uses `{username,password}`; password change uses `{currentPassword,newPassword}`. Errors return `{error: "message"}`.

```json
{"type":"income","amount":"125.50","date":"2026-10-26","category_id":1,"description":"Sales payment"}
```

Write amounts are decimal strings; reads return `amount_cents` integers. Inventory writes use `{name,quantity,unit_price}`; unit_price is a decimal string, quantity is an integer, and reads return unit_price_cents.

## Course originality

Written independently with AI assistance. The original SME project was inspected for its stack and finance-tracking concept; source modules, components, and database were not copied. Check your course's rules for reuse and AI disclosure before submission. Course compliance has not been verified.
