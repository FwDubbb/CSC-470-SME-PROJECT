import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync,rmSync,existsSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/index.js';
import { setOwner,createUser,resetUser,hashPassword,verifyPassword,hashToken } from '../server/auth.js';
import { openDatabase } from '../server/db.js';
import { makeBackup,restoreBackup } from '../scripts/maintenance.js';
import { lockDatabase } from '../server/storage.js';
const password='correct horse finance tracker';
async function start(filename=':memory:',options={}) {
  const app=createApp(filename,options);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const url=`http://127.0.0.1:${app.server.address().port}`;
  app.call=async(path,method='GET',body,auth={},headers={})=>{
    const response=await fetch(url+path,{method,headers:{'Content-Type':'application/json',...(auth.cookie?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrf}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const data=response.headers.get('content-type')?.includes('json')?await response.json():await response.text();
    return {status:response.status,data,response};
  };
  app.login=async(username='owner',pass=password,auth={})=>{
    const result=await app.call('/api/auth/login','POST',{username,password:pass},auth);
    return {...result,cookie:result.response.headers.get('set-cookie')?.split(';')[0],csrf:result.data.csrfToken};
  };
  app.close=async()=>{await new Promise(resolve=>app.server.close(resolve));app.db.close();};
  return app;
}
test('password hashes are salted, verified, and never plaintext',async()=>{
  const first=await hashPassword(password),second=await hashPassword(password);
  assert.notEqual(first,second);assert.ok(!first.includes(password));assert.ok(await verifyPassword(password,first));assert.equal(await verifyPassword('wrong',first),false);
  await assert.rejects(hashPassword('short'));await assert.rejects(hashPassword('a'.repeat(129)));
});
test('protected APIs, session rotation, CSRF, expiry, password changes, logout, and security headers',async()=>{
  const app=await start();
  try {
    assert.equal((await app.call('/api/auth/status')).data.configured,false);
    for(const path of ['/api/transactions','/api/summary','/api/categories','/api/export']) assert.equal((await app.call(path)).status,401);
    assert.equal((await app.call('/api/transactions','POST',{})).status,401);
    await setOwner(app.db,'owner',password);
    await assert.rejects(setOwner(app.db,'intruder',password));
    assert.equal((await app.login('owner','wrong')).status,401);
    assert.equal((await app.login('unknown','wrong')).data.error,'Invalid username or password.');
    const auth=await app.login();assert.equal(auth.status,200);
    const cookie=auth.response.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.doesNotMatch(cookie,/; Secure/);
    const token=auth.cookie.split('=')[1];const stored=app.db.prepare('SELECT * FROM sessions').get();assert.equal(stored.token_hash,hashToken(token));assert.notEqual(stored.token_hash,token);
    assert.equal((await app.call('/api/auth/status','GET',undefined,auth)).data.authenticated,true);
    for(const csrf of ['', 'bad', 'é'.repeat(64)]) assert.equal((await app.call('/api/auth/logout','POST',{},auth,{'X-CSRF-Token':csrf})).status,403);
    assert.equal((await app.call('/api/auth/logout','POST',{},auth,{Origin:'http://evil.test'})).status,403);
    assert.equal((await app.call('/api/auth/logout','POST',{},auth,{'Sec-Fetch-Site':'cross-site'})).status,403);
    const rotated=await app.login('owner',password,auth);assert.notEqual(rotated.cookie,auth.cookie);
    assert.equal((await app.call('/api/categories','GET',undefined,auth)).status,401);
    assert.equal((await app.call('/api/auth/password','POST',{currentPassword:'wrong',newPassword:password+' new'},rotated)).status,400);
    assert.equal((await app.call('/api/auth/password','POST',{currentPassword:password,newPassword:'short'},rotated)).status,400);
    const other=await app.login();
    assert.equal((await app.call('/api/auth/password','POST',{currentPassword:password,newPassword:password+' changed'},rotated)).status,200);
    assert.equal((await app.call('/api/categories','GET',undefined,other)).status,401);
    assert.equal((await app.login()).status,401);
    const changed=await app.login('owner',password+' changed');assert.equal(changed.status,200);
    app.db.prepare('UPDATE sessions SET last_seen=?').run(Date.now()-31*60*1000);
    assert.equal((await app.call('/api/categories','GET',undefined,changed)).status,401);
    const absolute=await app.login('owner',password+' changed');app.db.prepare('UPDATE sessions SET created_at=?').run(Date.now()-13*60*60*1000);
    assert.equal((await app.call('/api/categories','GET',undefined,absolute)).status,401);
    const final=await app.login('owner',password+' changed');
    const result=await app.call('/api/auth/logout','POST',{},final);assert.equal(result.status,200);assert.match(result.response.headers.get('set-cookie'),/Max-Age=0/);
    assert.equal((await app.call('/api/categories','GET',undefined,final)).status,401);
    const page=await app.call('/');assert.match(page.response.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(page.response.headers.get('cache-control'),'no-store');assert.equal(page.response.headers.get('x-content-type-options'),'nosniff');
  }finally{await app.close();}
});
test('login throttling, production cookie flags, session persistence, and owner reset',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ledger-auth-'));const file=join(dir,'db.sqlite');let app;
  try {
    app=await start(file,{secureCookies:true});await setOwner(app.db,'owner',password);
    for(let i=0;i<5;i++) assert.equal((await app.login('owner','wrong')).status,401);
    assert.equal((await app.login()).status,429);
    await app.close();app=null;app=await start(file,{secureCookies:true});assert.equal((await app.login()).status,429);
    app.db.prepare('UPDATE login_limits SET reset_at=0').run();
    const auth=await app.login();assert.match(auth.response.headers.get('set-cookie'),/; Secure/);
    await app.close();app=null;app=await start(file,{secureCookies:true});
    assert.equal((await app.call('/api/categories','GET',undefined,auth)).status,200);
    await resetUser(app.db,'owner',password+' reset');
    assert.equal((await app.call('/api/categories','GET',undefined,auth)).status,401);
    assert.equal((await app.login('owner',password+' reset')).status,200);
  }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('date/search filters, pagination, filtered totals and safe CSV export',async()=>{
  const app=await start();
  try {
    await setOwner(app.db,'owner',password);const auth=await app.login();
    const transactions=[
      {type:'income',amount:'100.10',date:'2026-10-01',category_id:1,description:'Client Alpha'},
      {type:'expense',amount:'20.05',date:'2026-10-31',category_id:4,description:'Rent Alpha'},
      {type:'income',amount:'10.00',date:'2026-09-30',category_id:2,description:'100%_literal'},
      {type:'income',amount:'5.00',date:'2026-11-01',category_id:1,description:'=HYPERLINK("evil")\nquoted, value'}
    ];
    for(const t of transactions) assert.equal((await app.call('/api/transactions','POST',t,auth)).status,201);
    const query='start=2026-10-01&end=2026-10-31&search=alpha';
    const result=await app.call('/api/transactions?'+query+'&pageSize=1','GET',undefined,auth);assert.equal(result.data.total,2);assert.equal(result.data.items.length,1);assert.equal(result.data.items[0].date,'2026-10-31');
    const next=await app.call('/api/transactions?'+query+'&pageSize=1&page=2','GET',undefined,auth);assert.equal(next.data.items[0].date,'2026-10-01');
    const totals=(await app.call('/api/summary?'+query,'GET',undefined,auth)).data;assert.deepEqual(totals.filtered,{income:10010,expenses:2005,balance:8005});assert.deepEqual(totals.allTime,{income:11510,expenses:2005,balance:9505});
    assert.equal((await app.call('/api/transactions?search='+encodeURIComponent('%_'),'GET',undefined,auth)).data.total,1);
    for(const q of ['start=2026-02-30','start=2026-11-01&end=2026-10-01','page=-1','pageSize=101','search='+'a'.repeat(251)]) assert.equal((await app.call('/api/transactions?'+q,'GET',undefined,auth)).status,400);
    const empty=await app.call('/api/transactions?search=missing&page=999','GET',undefined,auth);assert.deepEqual(empty.data.items,[]);assert.equal(empty.data.page,1);
    const csv=await app.call('/api/export?'+query+'&pageSize=1','GET',undefined,auth);assert.equal(csv.status,200);assert.match(csv.data,/Rent Alpha/);assert.match(csv.data,/Client Alpha/);assert.doesNotMatch(csv.data,/literal/);assert.match(csv.response.headers.get('content-disposition'),/attachment/);
    const all=await app.call('/api/export','GET',undefined,auth);assert.ok(all.data.includes("'="));assert.ok(all.data.includes('""evil""'));
  }finally{await app.close();}
});
test('existing finance database migration, verified backup/restore, and maintenance locking',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ledger-backup-'));const file=join(dir,'finance.sqlite'),snapshot=join(dir,'backup.sqlite'),prior=join(dir,'prior.sqlite');let app;
  try {
    const original=new DatabaseSync(file);original.exec("PRAGMA foreign_keys=ON;CREATE TABLE categories(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,type TEXT NOT NULL,UNIQUE(id,type));INSERT INTO categories VALUES (1,'Sales','income');CREATE TABLE transactions(id INTEGER PRIMARY KEY,type TEXT NOT NULL,amount_cents INTEGER NOT NULL,date TEXT NOT NULL,category_id INTEGER NOT NULL,description TEXT NOT NULL,FOREIGN KEY(category_id,type) REFERENCES categories(id,type));INSERT INTO transactions VALUES (7,'income',1234,'2026-10-26',1,'Existing');");original.close();
    app=await start(file);await setOwner(app.db,'owner',password);const auth=await app.login();
    assert.equal((await app.call('/api/transactions','GET',undefined,auth)).data.total,1);
    await app.close();app=null;await makeBackup(file,snapshot);
    const changed=new DatabaseSync(file);changed.exec('DELETE FROM transactions');changed.close();
    await restoreBackup(snapshot,file,prior);assert.ok(existsSync(prior));
    app=await start(file);assert.equal((await app.call('/api/categories','GET',undefined,auth)).status,401);
    const signed=await app.login();assert.equal((await app.call('/api/transactions','GET',undefined,signed)).data.items[0].amount_cents,1234);
    const pre=new DatabaseSync(prior,{readOnly:true});assert.equal(pre.prepare('SELECT COUNT(*) n FROM transactions').get().n,0);pre.close();
    await app.close();app=null;
    const invalid=join(dir,'invalid.sqlite');const invalidDb=new DatabaseSync(invalid);invalidDb.exec('CREATE TABLE unrelated(id INTEGER)');invalidDb.close();
    await assert.rejects(restoreBackup(invalid,file,join(dir,'invalid-prior.sqlite')));
    const finalDb=new DatabaseSync(file);assert.equal(finalDb.prepare('SELECT COUNT(*) n FROM transactions').get().n,1);finalDb.close();
    const release=lockDatabase(file);assert.throws(()=>lockDatabase(file),/in use/);release();
    writeFileSync(file+'.lock','99999999');const releaseStale=lockDatabase(file);releaseStale();
  }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('public signup validates credentials, permits separate accounts, and prevents duplicate usernames',async()=>{
  const app=await start();
  try {
    const signup=(body,headers={})=>app.call('/api/auth/signup','POST',body,{},headers);
    assert.equal((await signup({username:'owner',password,confirmPassword:'wrong'})).status,400);
    assert.equal((await signup({username:'x',password,confirmPassword:password})).status,400);
    assert.equal((await signup({username:'owner',password:'short',confirmPassword:'short'})).status,400);
    assert.equal((await signup({username:'owner',password,confirmPassword:password},{Origin:'http://evil.test'})).status,403);
    const payload={username:'owner',password,confirmPassword:password};
    const concurrent=await Promise.all([signup(payload),signup({...payload,username:'other-owner'})]);
    assert.deepEqual(concurrent.map(r=>r.status),[201,201]);
    const created=concurrent[0],auth={cookie:created.response.headers.get('set-cookie').split(';')[0],csrf:created.data.csrfToken};
    assert.equal((await app.call('/api/categories','GET',undefined,auth)).status,200);
    assert.equal((await signup({...payload,username:'OWNER'})).status,409);
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM users').get().n,2);
    assert.equal((await app.login('OwNeR')).status,200);
    const collision=await Promise.all([createUser(app.db,'same-account',password),createUser(app.db,'SAME-ACCOUNT',password)].map(p=>p.then(()=>201,e=>e.status)));
    assert.deepEqual(collision.sort(),[201,409]);
  }finally{await app.close();}
  const hosted=await start(':memory:',{secureCookies:true});
  try{assert.equal((await hosted.call('/api/auth/signup','POST',{username:'owner',password,confirmPassword:password})).status,201);}finally{await hosted.close();}
});

test('inventory CRUD, validation, authentication, persistence, and backup recovery',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ledger-inventory-')),file=join(dir,'db.sqlite'),snapshot=join(dir,'backup.sqlite'),prior=join(dir,'prior.sqlite');let app;
  const item={name:'Notebook',quantity:12,unit_price:'3.25'};
  try {
    app=await start(file);await setOwner(app.db,'owner',password);
    assert.equal((await app.call('/api/inventory')).status,401);
    assert.equal((await app.call('/api/inventory','POST',item)).status,401);
    let auth=await app.login();
    assert.equal((await app.call('/api/inventory','POST',item,auth,{'X-CSRF-Token':''})).status,403);
    assert.deepEqual((await app.call('/api/inventory','GET',undefined,auth)).data,[]);
    for(const invalid of [null,[],{},...[-1,1.5,1000001,'5'].map(quantity=>({...item,quantity})),{...item,name:' '},{...item,name:'x'.repeat(101)},...['-1','3.001','NaN','10000000'].map(unit_price=>({...item,unit_price})),{...item,unit_price:3}]) assert.equal((await app.call('/api/inventory','POST',invalid,auth)).status,400);
    const created=await app.call('/api/inventory','POST',item,auth);assert.equal(created.status,201);assert.equal(created.data.unit_price_cents,325);
    const id=created.data.id;
    assert.equal((await app.call('/api/inventory','POST',{...item,name:' NOTEBOOK '},auth)).status,409);
    assert.equal((await app.call('/api/inventory/'+id,'PUT',{...item,quantity:0,unit_price:'0.00'},auth)).status,200);
    assert.equal((await app.call('/api/inventory','GET',undefined,auth)).data[0].quantity,0);
    assert.deepEqual((await app.call('/api/summary','GET',undefined,auth)).data.allTime,{income:0,expenses:0,balance:0});
    assert.equal((await app.call('/api/inventory/999','PUT',item,auth)).status,404);
    await app.close();app=null;app=await start(file);auth=await app.login();
    assert.equal((await app.call('/api/inventory','GET',undefined,auth)).data[0].name,'Notebook');
    await app.close();app=null;await makeBackup(file,snapshot);
    const changed=new DatabaseSync(file);changed.exec('DELETE FROM inventory');changed.close();
    await restoreBackup(snapshot,file,prior);app=await start(file);auth=await app.login();
    assert.equal((await app.call('/api/inventory','GET',undefined,auth)).data.length,1);
    assert.equal((await app.call('/api/inventory/'+id,'DELETE',undefined,auth)).status,200);
    assert.equal((await app.call('/api/inventory/'+id,'DELETE',undefined,auth)).status,404);
    assert.deepEqual((await app.call('/api/inventory','GET',undefined,auth)).data,[]);
    await app.close();app=null;
    const old=new DatabaseSync(snapshot);old.exec('DROP TABLE inventory');old.close();
    await restoreBackup(snapshot,file,join(dir,'before-old-restore.sqlite'));app=await start(file);auth=await app.login();
    assert.deepEqual((await app.call('/api/inventory','GET',undefined,auth)).data,[]);
    assert.equal((await app.call('/api/inventory','POST',item,auth)).status,201);
  }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('separate accounts cannot read, count, export, edit, delete, or reassign each other\'s records',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'tallyroom-isolation-')),file=join(dir,'db.sqlite'),snapshot=join(dir,'snapshot.sqlite');let app;
  const transaction={type:'income',amount:'123.45',date:'2026-10-27',category_id:1,description:'A-only payment'};
  const stock={name:'Notebook',quantity:5,unit_price:'2.50'};
  try {
    app=await start(file);
    const signup=async username=>{const r=await app.call('/api/auth/signup','POST',{username,password,confirmPassword:password});assert.equal(r.status,201);return {cookie:r.response.headers.get('set-cookie').split(';')[0],csrf:r.data.csrfToken};};
    let a=await signup('person-a'),b=await signup('person-b');
    const idA=app.db.prepare("SELECT id FROM users WHERE username='person-a'").get().id;
    const idB=app.db.prepare("SELECT id FROM users WHERE username='person-b'").get().id;
    const ta=await app.call('/api/transactions','POST',transaction,a);
    const ia=await app.call('/api/inventory','POST',stock,a);
    const tb=await app.call('/api/transactions','POST',{...transaction,amount:'7.00',description:'B-only payment',user_id:idA},b);
    const ib=await app.call('/api/inventory','POST',{...stock,quantity:99,user_id:idA},b);
    assert.equal(ib.status,201);assert.equal(tb.status,201);
    for(const [viewer,otherT,otherI,otherName,expectedAmount] of [[a,tb,ib,'B-only',12345],[b,ta,ia,'A-only',700]]) {
      const rows=(await app.call('/api/transactions','GET',undefined,viewer)).data;assert.equal(rows.total,1);assert.equal(rows.items[0].amount_cents,expectedAmount);
      const totals=(await app.call('/api/summary','GET',undefined,viewer)).data;assert.equal(totals.allTime.income,expectedAmount);
      const filtered=(await app.call('/api/transactions?search='+otherName,'GET',undefined,viewer)).data;assert.equal(filtered.total,0);
      assert.equal((await app.call('/api/summary?search='+otherName,'GET',undefined,viewer)).data.filtered.income,0);
      assert.ok(!(await app.call('/api/export','GET',undefined,viewer)).data.includes(otherName));
      assert.equal((await app.call('/api/transactions/'+otherT.data.id,'PUT',transaction,viewer)).status,404);
      assert.equal((await app.call('/api/transactions/'+otherT.data.id,'DELETE',undefined,viewer)).status,404);
      assert.equal((await app.call('/api/inventory/'+otherI.data.id,'PUT',stock,viewer)).status,404);
      assert.equal((await app.call('/api/inventory/'+otherI.data.id,'DELETE',undefined,viewer)).status,404);
      assert.equal((await app.call('/api/inventory','GET',undefined,viewer)).data.length,1);
    }
    assert.equal((await app.call('/api/transactions/'+tb.data.id,'PUT',{...transaction,description:'B-only updated',amount:'7.00',user_id:idA},b)).status,200);
    assert.equal(app.db.prepare('SELECT user_id FROM transactions WHERE id=?').get(tb.data.id).user_id,idB);
    assert.equal(app.db.prepare('SELECT user_id FROM inventory WHERE id=?').get(ib.data.id).user_id,idB);
    assert.equal((await app.call('/api/transactions/'+ta.data.id,'DELETE',undefined,b,{'X-CSRF-Token':a.csrf})).status,403);
    assert.equal((await app.call('/api/auth/password','POST',{currentPassword:password,newPassword:password+' changed'},b)).status,200);
    assert.equal((await app.call('/api/inventory','GET',undefined,a)).status,200);
    assert.equal((await app.call('/api/inventory','GET',undefined,b)).status,401);
    b=await app.login('person-b',password+' changed');assert.equal(b.status,200);
    await resetUser(app.db,'person-b',password+' reset');
    assert.equal((await app.call('/api/inventory','GET',undefined,a)).status,200);
    assert.equal((await app.call('/api/inventory','GET',undefined,b)).status,401);
    await app.close();app=null;app=await start(file);
    assert.equal((await app.call('/api/summary','GET',undefined,a)).data.allTime.income,12345);
    b=await app.login('person-b',password+' reset');assert.equal((await app.call('/api/summary','GET',undefined,b)).data.allTime.income,700);
    await app.close();app=null;await makeBackup(file,snapshot);
    await restoreBackup(snapshot,file,join(dir,'before.sqlite'));app=await start(file);
    a=await app.login('person-a');b=await app.login('person-b',password+' reset');
    assert.equal((await app.call('/api/summary','GET',undefined,a)).data.allTime.income,12345);
    assert.equal((await app.call('/api/summary','GET',undefined,b)).data.allTime.income,700);
    assert.equal((await app.call('/api/inventory','GET',undefined,a)).data[0].quantity,5);
    assert.equal((await app.call('/api/inventory','GET',undefined,b)).data[0].quantity,99);
  }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('original single-owner database migrates with existing credentials, record IDs, and ownership intact',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'tallyroom-migration-')),file=join(dir,'old.sqlite');let app;
  try {
    const passwordHash=await hashPassword(password),old=new DatabaseSync(file);
    old.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE users(id INTEGER PRIMARY KEY CHECK(id=1),username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL);
      CREATE TABLE categories(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,type TEXT NOT NULL,UNIQUE(id,type));
      INSERT INTO categories VALUES(1,'Sales','income');
      CREATE TABLE transactions(id INTEGER PRIMARY KEY,type TEXT NOT NULL,amount_cents INTEGER NOT NULL,date TEXT NOT NULL,category_id INTEGER NOT NULL,description TEXT NOT NULL,FOREIGN KEY(category_id,type) REFERENCES categories(id,type));
      INSERT INTO transactions VALUES(42,'income',8750,'2026-10-27',1,'Legacy business income');
      CREATE TABLE inventory(id INTEGER PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,quantity INTEGER NOT NULL,unit_price_cents INTEGER NOT NULL);
      INSERT INTO inventory VALUES(23,'Legacy stock',8,500);
      CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),csrf_token TEXT NOT NULL,created_at INTEGER NOT NULL,last_seen INTEGER NOT NULL);`);
    old.prepare('INSERT INTO users VALUES(1,?,?)').run('existing-owner',passwordHash);old.close();
    app=await start(file);const owner=await app.login('existing-owner');assert.equal(owner.status,200);
    assert.equal((await app.call('/api/transactions','GET',undefined,owner)).data.items[0].id,42);
    assert.equal((await app.call('/api/inventory','GET',undefined,owner)).data[0].id,23);
    assert.equal(app.db.prepare('PRAGMA foreign_key_check').all().length,0);
    const signup=await app.call('/api/auth/signup','POST',{username:'new-user',password,confirmPassword:password});assert.equal(signup.status,201);
    const newcomer={cookie:signup.response.headers.get('set-cookie').split(';')[0],csrf:signup.data.csrfToken};
    assert.equal((await app.call('/api/transactions','GET',undefined,newcomer)).data.total,0);
    assert.deepEqual((await app.call('/api/inventory','GET',undefined,newcomer)).data,[]);
    const {readdirSync}=await import('node:fs');assert.ok(readdirSync(join(dir,'backups')).some(name=>name.startsWith('before-accounts-')));
  }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('signup abuse limits are persisted and do not disable existing account sign-in',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'tallyroom-signup-limit-')),file=join(dir,'db.sqlite');let app;
  try {
    app=await start(file);await createUser(app.db,'existing-person',password);
    for(let n=0;n<10;n++) assert.equal((await app.call('/api/auth/signup','POST',{})).status,400);
    assert.equal((await app.call('/api/auth/signup','POST',{username:'new-person',password,confirmPassword:password})).status,429);
    assert.equal((await app.login('existing-person')).status,200);
    await app.close();app=null;app=await start(file);
    assert.equal((await app.call('/api/auth/signup','POST',{})).status,429);
  }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});
