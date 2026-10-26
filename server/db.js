import { initializeInventory } from './inventory.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('income','expense')), UNIQUE(id,type)
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('income','expense')),
      amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 999999999),
      date TEXT NOT NULL, category_id INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=250),
      FOREIGN KEY(category_id,type) REFERENCES categories(id,type)
    );`);
  const seed = db.prepare('INSERT OR IGNORE INTO categories(name,type) VALUES (?,?)');
  for (const [type, names] of Object.entries({ income: ['Sales','Services','Other Income'], expense: ['Rent','Utilities','Supplies','Transportation','Other Expenses'] })) {
    for (const name of names) seed.run(name,type);
  }
  initializeInventory(db);
  return db;
}

export function validateTransaction(body, db) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('A transaction object is required.');
  const { type, amount, date, category_id, description = '' } = body;
  if (!['income','expense'].includes(type)) throw new Error('Select income or expense.');
  if (typeof amount !== 'string' || !/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(amount)) throw new Error('Enter a positive amount with at most two decimal places.');
  const [whole, fraction = ''] = amount.split('.');
  const cents = Number(whole)*100 + Number(fraction.padEnd(2,'0'));
  if (cents < 1 || cents > 999999999) throw new Error('Amount must be between 0.01 and 9,999,999.99.');
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '0001-01-01' || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new Error('Enter a valid calendar date.');
  if (!Number.isSafeInteger(category_id) || !db.prepare('SELECT id FROM categories WHERE id=? AND type=?').get(category_id,type)) throw new Error('Select a category matching the transaction type.');
  if (typeof description !== 'string' || description.trim().length > 250) throw new Error('Description must be 250 characters or fewer.');
  return { type, amount_cents: cents, date, category_id, description: description.trim() };
}
