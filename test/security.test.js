import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync,rmSync,existsSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/index.js';
import { setOwner,hashPassword,verifyPassword,hashToken } from '../server/auth.js';
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
    await setOwner(app.db,'new-owner',password+' reset',true);
    assert.equal((await app.call('/api/categories','GET',undefined,auth)).status,401);
    assert.equal((await app.login('new-owner',password+' reset')).status,200);
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
    const original=openDatabase(file);original.prepare("INSERT INTO transactions(type,amount_cents,date,category_id,description) VALUES ('income',1234,'2026-10-26',1,'Existing')").run();original.close();
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
