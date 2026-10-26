import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openDatabase, validateTransaction } from './db.js';
import { initializeAuth, sessionFor, startSession, clearCookie, verifyPassword, hashPassword, csrfMatches, setOwner } from './auth.js';
import { databasePath, lockDatabase } from './storage.js';
import { filters, summary, listTransactions, csv } from './queries.js';

const publicDirectory=new URL('../public/',import.meta.url);
const files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/styles.css':['styles.css','text/css']};
function respond(res,status,body) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));}
async function readBody(req) {
  if(req.headers['content-type']?.split(';')[0].trim()!=='application/json') throw new Error('Send JSON data.');
  const chunks=[];let size=0;
  for await(const chunk of req) {size+=chunk.length;if(size>8192) throw new Error('Request is too large.');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('Invalid JSON.');}
}
export function createApp(filename,{secureCookies=process.env.NODE_ENV==='production',appOrigin=process.env.APP_ORIGIN}={}) {
  const db=openDatabase(filename);initializeAuth(db);
  let activePasswordChecks=0, signupBusy=false;
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(secureCookies) res.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      const url=new URL(req.url,'http://localhost');
      const allowedOrigin=appOrigin || `http://${req.headers.host}`;
      if(!appOrigin && !/^((localhost|127\.0\.0\.1)(:\d+)?|\[::1\](:\d+)?)$/.test(req.headers.host || '')) return respond(res,403,{error:'Invalid host.'});
      const mutation=['POST','PUT','DELETE'].includes(req.method);
      if(mutation && (req.headers['sec-fetch-site']==='cross-site' || (req.headers.origin && req.headers.origin!==allowedOrigin))) return respond(res,403,{error:'Cross-origin changes are not allowed.'});
      if(req.method==='GET' && files[url.pathname]) {
        const [name,type]=files[url.pathname];const content=await readFile(new URL(name,publicDirectory));
        res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`});return res.end(content);
      }
      if(!url.pathname.startsWith('/api/')) return respond(res,404,{error:'Not found.'});
      const session=sessionFor(req,db);
      if(req.method==='GET' && url.pathname==='/api/auth/status') return respond(res,200,{configured:!!db.prepare('SELECT id FROM users').get(),authenticated:!!session,username:session?.username,csrfToken:session?.csrf_token});
      if(req.method==='POST' && url.pathname==='/api/auth/signup') {
        if(db.prepare('SELECT id FROM users').get()) return respond(res,409,{error:'An owner account already exists. Please sign in.'});
        if(secureCookies || !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return respond(res,403,{error:'First-time browser setup is available locally. Use account:setup on the server for hosted installations.'});
        if(signupBusy) return respond(res,409,{error:'Account creation is already in progress. Please retry.'});
        signupBusy=true;
        try {
          const body=await readBody(req);
          if(!body || body.password!==body.confirmPassword) throw new Error('Passwords do not match.');
          await setOwner(db,body.username,body.password);
          const csrfToken=startSession(db,res,secureCookies);
          return respond(res,201,{username:body.username,csrfToken});
        } finally {signupBusy=false;}
      }
      if(req.method==='POST' && url.pathname==='/api/auth/login') {
        const address=req.socket.remoteAddress || 'local',now=Date.now();
        db.prepare('DELETE FROM login_limits WHERE reset_at<=?').run(now);
        const limit=db.prepare('SELECT * FROM login_limits WHERE address=?').get(address);
        if(limit?.attempts>=5) {res.setHeader('Retry-After',Math.ceil((limit.reset_at-now)/1000));return respond(res,429,{error:'Too many login attempts. Try again in 15 minutes.'});}
        if(activePasswordChecks>=2) return respond(res,429,{error:'Sign-in is busy. Please retry shortly.'});
        const body=await readBody(req);
        if(!body || typeof body.username!=='string' || typeof body.password!=='string' || body.username.length>40 || body.password.length>128) return respond(res,400,{error:'Enter a valid username and password.'});
        db.prepare('INSERT INTO login_limits VALUES (?,1,?) ON CONFLICT(address) DO UPDATE SET attempts=attempts+1').run(address,now+15*60*1000);
        const user=db.prepare('SELECT * FROM users WHERE username=?').get(body.username);
        activePasswordChecks++;
        let valid;
        try {valid=await verifyPassword(body.password,user?.password_hash);} finally {activePasswordChecks--;}
        if(!valid || db.prepare('SELECT password_hash FROM users WHERE id=1').get()?.password_hash!==user?.password_hash) return respond(res,401,{error:'Invalid username or password.'});
        db.prepare('DELETE FROM login_limits WHERE address=?').run(address);
        const csrfToken=startSession(db,res,secureCookies,session);
        return respond(res,200,{username:user.username,csrfToken});
      }
      if(!session) return respond(res,401,{error:'Please sign in to continue.'});
      if(mutation && !csrfMatches(req.headers['x-csrf-token'],session.csrf_token)) return respond(res,403,{error:'Security token missing or invalid. Reload and try again.'});
      if(req.method==='POST' && url.pathname==='/api/auth/logout') {
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash);clearCookie(res,secureCookies);return respond(res,200,{message:'Signed out.'});
      }
      if(req.method==='POST' && url.pathname==='/api/auth/password') {
        const body=await readBody(req);
        if(!body || typeof body.currentPassword!=='string' || body.currentPassword.length>128) throw new Error('Enter your current password.');
        if(activePasswordChecks>=2) return respond(res,429,{error:'Password service is busy. Please retry.'});
        const now=Date.now(),address=req.socket.remoteAddress;
        db.prepare('DELETE FROM login_limits WHERE reset_at<=?').run(now);
        if(db.prepare('SELECT attempts FROM login_limits WHERE address=?').get(address)?.attempts>=5) return respond(res,429,{error:'Too many attempts. Try again in 15 minutes.'});
        db.prepare('INSERT INTO login_limits VALUES (?,1,?) ON CONFLICT(address) DO UPDATE SET attempts=attempts+1').run(address,now+15*60*1000);
        activePasswordChecks++;
        let passwordHash,verifiedHash;
        try {
          const user=db.prepare('SELECT * FROM users WHERE id=1').get();
          verifiedHash=user.password_hash;
          if(!await verifyPassword(body.currentPassword,user.password_hash)) return respond(res,400,{error:'Current password is incorrect.'});
          if(body.currentPassword===body.newPassword) throw new Error('Choose a different new password.');
          passwordHash=await hashPassword(body.newPassword);
        } finally {activePasswordChecks--;}
        if(db.prepare('SELECT password_hash FROM users WHERE id=1').get()?.password_hash!==verifiedHash || !db.prepare('SELECT token_hash FROM sessions WHERE token_hash=?').get(session.token_hash)) return respond(res,409,{error:'Credentials changed during this request. Sign in again.'});
        db.exec('BEGIN IMMEDIATE');
        try {db.prepare('UPDATE users SET password_hash=? WHERE id=1').run(passwordHash);db.exec('DELETE FROM sessions; DELETE FROM login_limits; COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
        clearCookie(res,secureCookies);return respond(res,200,{message:'Password changed. Sign in again on all devices.'});
      }
      if(req.method==='GET' && url.pathname==='/api/categories') return respond(res,200,db.prepare('SELECT * FROM categories ORDER BY id').all());
      if(req.method==='GET' && ['/api/summary','/api/transactions','/api/export'].includes(url.pathname)) {
        const {where,values}=filters(url.searchParams);
        if(url.pathname==='/api/summary') return respond(res,200,{allTime:summary(db),filtered:summary(db,where,values)});
        if(url.pathname==='/api/export') {
          const content=csv(listTransactions(db,where,values));res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="ledger-transactions.csv"'});return res.end(content);
        }
        const page=Number(url.searchParams.get('page') || 1),pageSize=Number(url.searchParams.get('pageSize') || 20);
        if(!Number.isSafeInteger(page)||page<1||page>1000000||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100) throw new Error('Invalid pagination.');
        const total=db.prepare(`SELECT COUNT(*) total FROM transactions t ${where}`).get(...values).total;
        const actualPage=Math.min(page,Math.max(1,Math.ceil(total/pageSize)));
        return respond(res,200,{items:listTransactions(db,where,values,'LIMIT ? OFFSET ?',[pageSize,(actualPage-1)*pageSize]),total,page:actualPage,pageSize});
      }
      const match=url.pathname.match(/^\/api\/transactions\/([1-9]\d*)$/);
      if((req.method==='POST' && url.pathname==='/api/transactions') || (req.method==='PUT' && match)) {
        const t=validateTransaction(await readBody(req),db);
        if(match) {
          const result=db.prepare('UPDATE transactions SET type=?,amount_cents=?,date=?,category_id=?,description=? WHERE id=?').run(t.type,t.amount_cents,t.date,t.category_id,t.description,Number(match[1]));
          return respond(res,result.changes?200:404,result.changes?{id:Number(match[1]),...t}:{error:'Transaction not found.'});
        }
        const result=db.prepare('INSERT INTO transactions(type,amount_cents,date,category_id,description) VALUES (?,?,?,?,?)').run(t.type,t.amount_cents,t.date,t.category_id,t.description);
        return respond(res,201,{id:Number(result.lastInsertRowid),...t});
      }
      if(req.method==='DELETE' && match) {
        const result=db.prepare('DELETE FROM transactions WHERE id=?').run(Number(match[1]));return respond(res,result.changes?200:404,result.changes?{message:'Transaction deleted.'}:{error:'Transaction not found.'});
      }
      respond(res,404,{error:'Not found.'});
    } catch(error) {
      if(error.code) {console.error('Request failed:',error.code);respond(res,500,{error:'Unable to complete request. Please retry.'});}
      else respond(res,400,{error:error.message || 'Invalid request.'});
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return {server,db};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(process.env.NODE_ENV==='production' && !process.env.APP_ORIGIN?.startsWith('https://')) throw new Error('Production requires APP_ORIGIN=https://your-host and an HTTPS reverse proxy.');
  const unlock=lockDatabase(databasePath);
  const {server,db}=createApp(databasePath);
  process.on('exit',unlock);
  server.on('error',error=>{console.error(error.message);db.close();process.exit(1);});
  server.listen(Number(process.env.PORT || 3000),'127.0.0.1',()=>console.log(`Finance Tracker: http://localhost:${process.env.PORT || 3000}`));
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
}
