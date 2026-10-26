# Simple Business Finance Tracker

A separate class project focused on income, expenses, predefined categories, transaction history, and three all-time totals. No inventory, accounts, authentication, reporting, or other SME modules.

## Structure

- `public/`: one responsive page, styles, and browser JavaScript
- `server/`: HTTP API, input validation, and SQLite persistence
- `test/`: isolated integration tests
- `data/`: local database (ignored by Git)

## Database

Exactly two tables: `categories(id, name, type)` and `transactions(id, type, amount_cents, date, category_id, description)`. A composite foreign key ensures category and transaction types agree. Money uses integer cents. Categories are seeded automatically; transactions start empty.

## Development approach

Build this application independently, using the original SME project only as a reference for the finance-tracking concept and SQLite persistence. No original modules or source files are copied.

## Setup and installation

Install Node.js **24.10 or later** (tested with 24.10.0), which includes the SQLite module used here. Git is needed only for version control. There are no third-party packages to install, no database service, and no frontend build step.

From this project directory:

```sh
npm start
```

Open **http://localhost:3000**. The server binds to your computer's loopback interface. Stop it with Ctrl+C. `npm run dev` restarts the server when server files change; refresh the browser after changing frontend files.

SQLite tables and eight predefined categories are created automatically on first start. Your records are stored in `data/finance.sqlite` and survive server restarts. The database is excluded from Git. Node 24.10 may print an experimental SQLite warning; this is expected.

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `data/finance.sqlite` inside this project | Alternative database file (relative paths resolve from the shell directory) |

PowerShell example:

```powershell
$env:PORT = '3001'
npm start
```

## Usage

1. Select Income or Expense, then enter a positive USD amount, date, and category. Add an optional description up to 250 characters.
2. Select **Add transaction**. The history and all-time totals refresh immediately after a successful save.
3. Select **Edit** beside a record, change its details, and save. **Cancel editing** discards unsaved changes.
4. Select **Delete**, then confirm removal in the dialog.
5. Use the type and category filters together or separately. Filters affect history only; the dashboard always shows all recorded transactions.

The app starts with no sample transactions. It uses USD and supports amounts from $0.01 to $9,999,999.99 per record, with at most two decimal places. Both past and future dates are permitted. Categories are fixed and depend on the transaction type.

This is a single-user local application with no registration or login. Run it locally; shared internet hosting would require a separate access-control decision. Back up the database with the server stopped; copy the `data/` folder to a safe location. Do not commit personal financial data.

## Tests

```sh
npm test
```

Tests use temporary databases and never write to your real finance database. They exercise API CRUD, combined filters, empty and negative balances, integer-cent arithmetic, validation failures, missing records, category/type constraints, static-file serving, and reopening the same database after restart. Browser JavaScript syntax is also checked during development with `node --check public/app.js`.

Browser layout and interaction should be checked manually on desktop and mobile: add both transaction types, edit a record's type and amount, cancel an edit, dismiss and confirm a delete, combine filters, and reload the page. No automated browser verification was available in the development session.

## API

All writes use JSON and return `{ "error": "message" }` on failure.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/categories` | Predefined categories |
| GET | `/api/transactions?type=income&category=1` | Newest records first; both filters optional |
| POST | `/api/transactions` | Create a record |
| PUT | `/api/transactions/:id` | Replace a record's editable fields |
| DELETE | `/api/transactions/:id` | Delete a record |
| GET | `/api/summary` | All-time income, expenses, and balance in cents |

Example write body:

```json
{"type":"income","amount":"125.50","date":"2026-10-26","category_id":1,"description":"Sales payment"}
```

Amounts must be decimal **strings** on writes; reads return integer `amount_cents`. Successful creation returns HTTP 201; updates and deletes return 200; invalid input returns 400; missing records return 404. SQL uses bound parameters and displayed text is rendered as text rather than HTML.

## Course originality and attribution

This project was written independently with AI assistance. The existing SME Business Management System was inspected only to understand its stack and financial-recordkeeping concept. Its source code, database, UI components, and unrelated modules were not copied. This project uses Node's built-in HTTP server and SQLite with plain browser JavaScript instead of the original React/Express application.

**Before submitting, check your syllabus or ask your instructor whether concept reuse from your own prior work and AI-assisted development are permitted.** Follow any disclosure or citation requirements. The development session did not have access to course rules and cannot certify compliance.

## Repository

This standalone finance tracker is maintained at https://github.com/FwDubbb/CSC-470-SME-PROJECT. It is separate from the original SME Business Management System. The repository name reflects the course project; the application's scope remains limited to basic income and expense tracking.

Clone and run:

```sh
git clone https://github.com/FwDubbb/CSC-470-SME-PROJECT.git
cd CSC-470-SME-PROJECT
npm start
```

Requires Node.js 24.10 or later. No package installation is needed. Open http://localhost:3000.
