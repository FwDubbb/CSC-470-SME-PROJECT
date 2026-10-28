import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { initializeSchema } from './schema.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL');
  try {
    const oldUsers=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
    const oldTransactions=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transactions'").get();
    const needsMigration=(oldUsers && /CHECK\s*\(\s*id\s*=\s*1\s*\)/i.test(oldUsers.sql)) || (oldTransactions && !db.prepare('PRAGMA table_info(transactions)').all().some(column=>column.name==='user_id'));
    if(filename!==':memory:' && needsMigration) {
      const folder=join(dirname(filename),'backups');mkdirSync(folder,{recursive:true});
      db.prepare('VACUUM INTO ?').run(join(folder,'before-accounts-'+Date.now()+'-'+randomUUID()+'.sqlite'));
    }
    initializeSchema(db);
  }catch(error){db.close();throw error;}

  const seed = db.prepare('INSERT OR IGNORE INTO categories(name,type) VALUES (?,?)');
  for (const [type, names] of Object.entries({ income: ['Sales','Services','Other Income'], expense: ['Rent','Utilities','Supplies','Transportation','Other Expenses'] })) {
    for (const name of names) seed.run(name,type);
  }
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
