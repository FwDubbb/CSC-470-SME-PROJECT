# Tallyroom — Simple Business Finance Tracker

Tallyroom is a small class project with separate user accounts with login, income/expense CRUD, predefined categories, date/category/type filters, description search, all-time and filtered totals, CSV export, pagination, duplication, basic inventory management, and database backup/restore.

Repository: https://github.com/FwDubbb/CSC-470-SME-PROJECT

## Setup

Install **Node.js 24.10 or later**. No third-party packages, database service, or build step are needed.

```sh
git clone https://github.com/FwDubbb/CSC-470-SME-PROJECT.git
cd CSC-470-SME-PROJECT
npm run dev
```

Open **http://localhost:3000**. Select **Create account** to register or **Sign in** to access an existing account. Signup remains available even when other accounts exist. A new account is signed in automatically and starts with its own empty workspace.

Choose a username of 3-40 letters/digits/dots/underscores/hyphens and a unique password of 15-128 characters. No default password is shipped. Stop with Ctrl+C. The dev command enables server auto-restart; npm start runs without watching files. Node 24.10 may print an experimental SQLite warning.

Existing single-owner databases migrate automatically: existing credentials stay valid and existing transactions/inventory belong to that account. Before migration, a recovery snapshot is saved under data/backups/before-linked-sales-*.sqlite. Existing sessions are revoked during the upgrade; sign in again. If a legacy database never had an account, its records are assigned to the first account created. New accounts never inherit another registered account's data. Signup also works in HTTPS production configurations; terminal account creation remains optional.

## Usage

- Record income or expenses with an amount, date, category, and optional description (250 characters maximum).
- Edit, cancel unsaved edits, or delete after confirmation. Deletion is permanent.
- Duplicate fills the form for review; saving creates a new transaction. Review its date before saving.
- Combine type, category, inclusive start/end dates, and description search. Search treats `%` and `_` literally and is case-insensitive for basic Latin text.
- Use This month, Last month, This year, or custom dates. Clear filters resets the selection.
- Main cards show **all-time totals**. Matching-record totals use **all active filters across every page**.
- Choose 20, 50, or 100 records per page. Export CSV downloads every matching record, including other pages.
- Change password from the header with your current password. This revokes all sessions for your account only. Sign out revokes the current session and clears displayed records.

Income categories: Sales, Services, Other Income. Expense categories: Rent, Utilities, Supplies, Transportation, Other Expenses. Categories remain predefined.

Amounts are USD, stored as integer cents, and must be between $0.01 and $9,999,999.99 per transaction. Dates may be past or future; future entries count immediately. Balance is recorded income minus expenses, without bank integration or an opening balance feature.

## Basic inventory

Use the Inventory link to add items with a name, quantity in stock, and unit price in USD. Search by name, edit to update stock or price, and delete after confirmation. Zero quantity is marked Out of stock. Item names are unique within your account without regard to letter case. Other accounts can use the same item names. Quantities are whole numbers from 0 to 1,000,000; prices can be zero and allow at most two decimal places.

### Record a sale from inventory

Click **Sell** beside an inventory item, or choose **Inventory sale** in the transaction form. Select the item and quantity. Its inventory price fills in automatically; you can enter the actual sale price. The total is calculated as quantity times unit price. Choose a date, optionally enter a description, and select **Record sale**.

A notebook priced at $5.00 with 3 units in stock: selling 1 creates $5.00 of income in the Sales category and leaves 2 units. Saving a sale and reducing stock happen together in one database transaction. Insufficient stock rejects the whole operation. Manual income/expense entries do not affect inventory, even if categorized as Sales.

Edit a sale from transaction history to change quantity, item, price, or date. The previous stock deduction is reversed and the new deduction applied atomically; a failed edit leaves both the original sale and stock unchanged. Deleting a sale restores its quantity and removes its income. Duplicating a sale creates a new sale only after saving and deducts stock again. Converting a sale to a manual entry restores the old stock.

History and CSV exports retain the sold item name, quantity, and sale unit price. Later price/name changes in inventory do not rewrite past sales. An item with linked sales cannot be deleted while that history exists; keep it at zero stock, or delete its sales first (which restores stock). Sale reversal is blocked if restoration would exceed the 1,000,000-unit limit; correct stock first.

Inventory requires login and uses the same account ownership as transactions. Edit stock quantities manually for restocks/corrections. There are no suppliers, purchase orders, shopping carts, multi-item orders, or stock-movement reports. Older backups still restore successfully.


## Password recovery

Stop the server and run:

```sh
npm run account:reset
```

Enter the exact existing account username and choose a new password. Only that account's password and sessions change; other accounts and all records stay intact. Recovery requires server filesystem access; there is no email recovery. This is an administrator maintenance command, not a public password-reset endpoint.

## Backup and restore

Stop the server first. Database locking prevents maintenance during normal server operation.

```sh
npm run backup
npm run restore -- "C:/path/to/finance-backup.sqlite"
```

Backup creates a consistent snapshot under `data/backups/` and prints its path. Copy it to a private safe location. Backups contain financial information and password hashes.

Restore validates SQLite integrity, expected finance columns, and foreign keys before staging a replacement. It saves the current database as a **before-restore** backup, replaces the active database, and revokes restored sessions. Use only trusted backups. Sign in with the credentials in the backup, or reset the relevant account locally. Older finance backups without auth tables are supported; the first account created afterward owns their records. Backups contain all accounts, so backup and restore are server-administrator operations. Ordinary users export only their own data through CSV.

Database files, backups, locks, and browser screenshots are ignored by Git. Cloning GitHub retrieves source code, not your financial records.

## Security

- Asynchronous **scrypt** password hashing: random 16-byte salt, N=131072, r=8, p=1, 64-byte derived key. Passwords are never stored as plaintext. Hash comparisons use `timingSafeEqual`.
- Random 256-bit session tokens; SQLite stores their SHA-256 hashes. Cookies use **HttpOnly**, **SameSite=Strict**, and **Secure** in production.
- Sessions expire after 30 minutes idle or 12 hours total, survive restarts until expiry, and rotate on login. Logout invalidates the current session; password change/reset revokes only that account's sessions.
- Authenticated mutations require a session-specific CSRF token. Cross-origin browser writes are rejected. Tokens stay in browser memory rather than localStorage.
- Five login attempts per source address within 15 minutes trigger a temporary block, persisted across restarts. Password-verification concurrency is bounded. Unknown users and incorrect passwords receive the same error.
- All finance and inventory endpoints require authentication. Every query, count, total, export, update, and delete is scoped by the signed-in user ID from the session. Client-provided user IDs are ignored. Attempts to edit/delete another account's records return 404.
- Signup allows at most 10 attempts per source address per hour. Username uniqueness is case-insensitive. Concurrent registration cannot replace an existing account.
- Parameterized SQL, server input validation, safe text rendering, Content Security Policy, frame blocking, no-store caching, body limits, and request timeouts add protection.
- CSV text is escaped and formula-like values are prefixed against spreadsheet formula execution. Some spreadsheet applications may display the prefix.

This is a local class application, not an independently audited security product. Authentication does not encrypt SQLite or backups; filesystem access can bypass application controls. MFA, shared-business teams, email recovery, and distributed rate limiting are outside scope.

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
scripts/    Account setup/reset, backup/restore, browser checks
test/       Finance and security integration tests
data/       Ignored local database and backups
```

Users share one SQLite database file, with ownership enforced by the backend and foreign keys:

- users(id,username,password_hash): individual accounts.
- transactions(id,user_id,type,amount_cents,date,category_id,description,inventory_id,sale_quantity,sale_unit_price_cents,sale_item_name): each entry belongs to one account; sale fields are optional for manual entries.
- inventory(id,user_id,name,quantity,unit_price_cents): each item belongs to one account; names are unique per account.
- categories(id,name,type): shared, read-only predefined choices; no personal data.
- sessions and login_limits: authentication support.

All-time/filtered totals, history, search, pagination, and CSV export include only the current account. A composite category foreign key still enforces transaction type/category consistency. There are no shared business workspaces or staff roles.

## Tests

```sh
npm test
npm run test:browser
```

API tests use temporary databases and cover two-account isolation (including guessed IDs and CSV exports), legacy ownership migration, account-specific password resets, CRUD, filters, cents arithmetic, validation, persistence, migration, hashing, protected APIs, throttling, CSRF, session rotation/expiry/revocation, password changes, production cookie flags, CSV, pagination, backups, restore, and locking.

Optional browser checks require installed Chrome/Edge (or `BROWSER_PATH`). They use a temporary database/profile and check desktop/mobile workflows, writing ignored screenshots under `artifacts/`. They never access your real financial database. Browser checks are separate from the portable API suite.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/auth/status` | Setup status/current session |
| POST | `/api/auth/signup` | Register a separate account and sign in |
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

History, summary, and export accept `type`, `category`, `start`, `end`, and `search`. History also accepts `page` and `pageSize` (1–100), returning `{items,total,page,pageSize}`. Protected writes require the session cookie and `X-CSRF-Token` from login/status. Signup uses `{username,password,confirmPassword}`. Login uses `{username,password}`; password change uses `{currentPassword,newPassword}`. Errors return `{error: "message"}`.

```json
{"type":"income","amount":"125.50","date":"2026-10-26","category_id":1,"description":"Sales payment"}
```

For an inventory sale, POST the transaction with inventory_id (integer), quantity (integer), unit_price (decimal string, optional to use the stored price), date, and optional description. The server chooses the Sales category and calculates income; client-provided totals are not trusted. PUT uses the same fields. Send inventory_id:null with normal transaction fields to convert a sale to a manual entry.

Write amounts are decimal strings; reads return `amount_cents` integers. Inventory writes use `{name,quantity,unit_price}`; unit_price is a decimal string, quantity is an integer, and reads return unit_price_cents.

## Course originality

Written independently with AI assistance. The original SME project was inspected for its stack and finance-tracking concept; source modules, components, and database were not copied. Check your course's rules for reuse and AI disclosure before submission. Course compliance has not been verified.
