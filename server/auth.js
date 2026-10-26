import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const parameters = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
export const hashToken = value => createHash('sha256').update(value).digest('hex');
export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 15 || password.length > 128) throw new Error('Use a password or passphrase with 15–128 characters.');
}
export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64, parameters);
  return `scrypt$131072$8$1$${salt}$${hash.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const parts = stored?.split('$');
  const valid = parts?.length === 6 && parts[0] === 'scrypt';
  const salt = valid ? parts[4] : '00000000000000000000000000000000';
  const expected = valid ? Buffer.from(parts[5], 'hex') : Buffer.alloc(64);
  const actual = await derive(password, salt, 64, parameters);
  return expected.length === actual.length && timingSafeEqual(actual, expected) && valid;
}
export function initializeAuth(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    csrf_token TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_limits (
    address TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL
  );`);
}
export async function setOwner(db, username, password, reset = false) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) throw new Error('Username must be 3–40 letters, digits, dots, underscores, or hyphens.');
  if (!reset && db.prepare('SELECT id FROM users').get()) throw new Error('An owner already exists. Use npm run account:reset to reset credentials.');
  const passwordHash = await hashPassword(password);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!reset && db.prepare('SELECT id FROM users').get()) throw new Error('An owner already exists. Sign in instead.');
    db.prepare('INSERT INTO users(id,username,password_hash) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,password_hash=excluded.password_hash').run(username,passwordHash);
    db.exec('DELETE FROM sessions; DELETE FROM login_limits; COMMIT');
  } catch(error) {db.exec('ROLLBACK');throw error;}
}
export function sessionFor(req, db) {
  const token = req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('ledger_session='))?.slice(15);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = hashToken(token);
  const session = db.prepare('SELECT s.*,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=?').get(hash);
  if (!session) return null;
  const now=Date.now();
  if(now-session.created_at>=12*60*60*1000 || now-session.last_seen>=30*60*1000) { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash); return null; }
  db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').run(now,hash);
  return session;
}
export function startSession(db, res, secure, previous) {
  const now=Date.now();
  db.prepare('DELETE FROM sessions WHERE created_at<? OR last_seen<?').run(now-12*60*60*1000,now-30*60*1000);
  if(previous) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(previous.token_hash);
  const token=randomBytes(32).toString('hex'), csrf=randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES (?,1,?,?,?)').run(hashToken(token),csrf,now,now);
  res.setHeader('Set-Cookie',`ledger_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure?'; Secure':''}`);
  return csrf;
}
export function clearCookie(res,secure) {
  res.setHeader('Set-Cookie',`ledger_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure?'; Secure':''}`);
}
export function csrfMatches(actual,expected) {
  return typeof actual==='string' && /^[a-f0-9]{64}$/.test(actual) && actual.length===expected.length && timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}
