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
