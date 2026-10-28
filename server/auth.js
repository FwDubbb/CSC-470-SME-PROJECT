import { initializeSchema, pendingUsername } from './schema.js';
﻿import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
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
export function initializeAuth(db) {initializeSchema(db);}
function validateUsername(username) {
  if(typeof username!=='string' || !/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) throw new Error('Username must be 3-40 letters, digits, dots, underscores, or hyphens.');
}
export async function createUser(db,username,password) {
  validateUsername(username);
  if(db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(username)) {const error=new Error('That username is already taken. Choose another or sign in.');error.status=409;throw error;}
  const passwordHash=await hashPassword(password);
  db.exec('BEGIN IMMEDIATE');
  try {
    if(db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(username)) {const error=new Error('That username is already taken.');error.status=409;throw error;}
    const pending=db.prepare('SELECT id FROM users WHERE username=? AND password_hash=?').get(pendingUsername,'!unclaimed');
    let id;
    if(pending) {id=pending.id;db.prepare('UPDATE users SET username=?,password_hash=? WHERE id=?').run(username,passwordHash,id);}
    else id=Number(db.prepare('INSERT INTO users(username,password_hash) VALUES (?,?)').run(username,passwordHash).lastInsertRowid);
    db.exec('COMMIT');return {id,username};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
export async function resetUser(db,username,password) {
  validateUsername(username);
  const user=db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(username);
  if(!user) throw new Error('Account not found. Enter the existing username to reset its password.');
  const passwordHash=await hashPassword(password);
  db.exec('BEGIN IMMEDIATE');
  try{db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash,user.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);db.exec('DELETE FROM login_limits; COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  return user;
}
// Kept for the optional first-account CLI and older integration helpers.
export async function setOwner(db,username,password,reset=false) {
  if(reset) return resetUser(db,username,password);
  if(db.prepare('SELECT id FROM users WHERE username<>?').get(pendingUsername)) throw new Error('An account already exists. Use browser signup to add another account.');
  return createUser(db,username,password);
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
export function startSession(db, res, secure, userId, previous) {
  const now=Date.now();
  db.prepare('DELETE FROM sessions WHERE created_at<? OR last_seen<?').run(now-12*60*60*1000,now-30*60*1000);
  if(previous) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(previous.token_hash);
  const token=randomBytes(32).toString('hex'), csrf=randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?)').run(hashToken(token),userId,csrf,now,now);
  res.setHeader('Set-Cookie',`ledger_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure?'; Secure':''}`);
  return csrf;
}
export function clearCookie(res,secure) {
  res.setHeader('Set-Cookie',`ledger_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure?'; Secure':''}`);
}
export function csrfMatches(actual,expected) {
  return typeof actual==='string' && /^[a-f0-9]{64}$/.test(actual) && actual.length===expected.length && timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}
