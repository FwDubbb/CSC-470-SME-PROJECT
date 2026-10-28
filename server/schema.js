// Migrate the original single-owner database atomically, preserving IDs and records.
const userTable=`CREATE TABLE users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL
)`;
const transactionTable=name=>`CREATE TABLE ${name} (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('income','expense')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 999999999),
  date TEXT NOT NULL, category_id INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=250),
  FOREIGN KEY(category_id,type) REFERENCES categories(id,type)
)`;
const inventoryTable=name=>`CREATE TABLE ${name} (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL COLLATE NOCASE CHECK(length(name) BETWEEN 1 AND 100),
  quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity BETWEEN 0 AND 1000000),
  unit_price_cents INTEGER NOT NULL CHECK(typeof(unit_price_cents)='integer' AND unit_price_cents BETWEEN 0 AND 999999999),
  UNIQUE(user_id,name)
)`;
export const pendingUsername='[legacy pending]';
export function initializeSchema(db) {
  const table=name=>db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name);
  const owned=name=>db.prepare(`PRAGMA table_info(${name})`).all().some(c=>c.name==='user_id');
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
  try {
    const oldUsers=table('users');
    const legacyUsers=oldUsers && /CHECK\s*\(\s*id\s*=\s*1\s*\)/i.test(oldUsers.sql);
    if(legacyUsers) {
      db.exec(userTable.replace('CREATE TABLE users','CREATE TABLE users_upgrade'));
      db.exec('INSERT INTO users_upgrade SELECT id,username,password_hash FROM users; DROP TABLE users; ALTER TABLE users_upgrade RENAME TO users');
    } else if(!oldUsers) db.exec(userTable);
    db.exec(`CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('income','expense')), UNIQUE(id,type)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      csrf_token TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_limits (address TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL);`);
    const legacyTables=['transactions','inventory'].filter(name=>table(name) && !owned(name));
    if(legacyTables.some(name=>db.prepare(`SELECT COUNT(*) n FROM ${name}`).get().n>0) && !db.prepare('SELECT id FROM users').get()) {
      // An old database without credentials is claimed once, by the first account.
      db.prepare('INSERT INTO users(id,username,password_hash) VALUES (1,?,?)').run(pendingUsername,'!unclaimed');
    }
    const owner=db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()?.id || 1;
    for(const [name,definition,fields] of [
      ['transactions',transactionTable,'id,type,amount_cents,date,category_id,description'],
      ['inventory',inventoryTable,'id,name,quantity,unit_price_cents']
    ]) {
      if(!table(name)) db.exec(definition(name));
      else if(!owned(name)) {
        db.exec(definition(name+'_upgrade'));
        db.exec(`INSERT INTO ${name}_upgrade(user_id,${fields}) SELECT ${owner},${fields} FROM ${name}; DROP TABLE ${name}; ALTER TABLE ${name}_upgrade RENAME TO ${name}`);
      }
    }
    if(legacyUsers) db.exec('DELETE FROM sessions');
    db.exec('CREATE INDEX IF NOT EXISTS transactions_owner_date ON transactions(user_id,date DESC,id DESC); PRAGMA user_version=2');
    if(db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database migration found broken relationships. Original data was preserved.');
    db.exec('COMMIT');
  } catch(error) {db.exec('ROLLBACK');throw error;}
  finally {db.exec('PRAGMA foreign_keys=ON');}
}
