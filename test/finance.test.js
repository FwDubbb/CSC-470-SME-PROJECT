import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/index.js';
import { setOwner } from '../server/auth.js';

async function start(file) {
  const app=createApp(file);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  app.url=`http://127.0.0.1:${app.server.address().port}`;
  app.close=async()=>{await new Promise(resolve=>app.server.close(resolve));app.db.close();};
  if(!app.db.prepare('SELECT id FROM users').get()) await setOwner(app.db,'owner','test-only-long-passphrase');
  const login=await fetch(app.url+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:'test-only-long-passphrase'})});
  app.cookie=login.headers.get('set-cookie').split(';')[0];app.csrf=(await login.json()).csrfToken;
  app.request=async(path,method='GET',body)=>{
    const response=await fetch(app.url+path,{method,headers:{'Content-Type':'application/json',Cookie:app.cookie,'X-CSRF-Token':app.csrf},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  return app;
}
const income={type:'income',amount:'100.10',date:'2026-10-26',category_id:1,description:'Services payment'};
const expense={type:'expense',amount:'25.05',date:'2026-10-25',category_id:4,description:'Rent'};
test('CRUD, filtering, exact-cent totals, HTML serving, and restart persistence',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'finance-test-'));const filename=join(dir,'test.sqlite');let app;
  try {
    app=await start(filename);
    assert.equal((await fetch(app.url)).status,200);
    for(const file of ['/app.js','/styles.css']) assert.equal((await fetch(app.url+file)).status,200);
    assert.equal((await app.request('/api/categories')).body.length,8);
    assert.deepEqual((await app.request('/api/summary')).body.allTime,{income:0,expenses:0,balance:0});
    const a=await app.request('/api/transactions','POST',income);assert.equal(a.status,201);
    const b=await app.request('/api/transactions','POST',expense);assert.equal(b.status,201);
    assert.deepEqual((await app.request('/api/summary')).body.allTime,{income:10010,expenses:2505,balance:7505});
    const rows=(await app.request('/api/transactions')).body.items;assert.equal(rows.length,2);assert.equal(rows[0].id,a.body.id);
    assert.equal((await app.request('/api/transactions?type=expense')).body.items[0].id,b.body.id);
    assert.equal((await app.request('/api/transactions?category=1')).body.items.length,1);
    assert.equal((await app.request('/api/transactions?type=expense&category=1')).body.items.length,0);
    assert.equal((await app.request('/api/transactions/'+a.body.id,'PUT',{...expense,amount:'0.10',description:''})).status,200);
    assert.deepEqual((await app.request('/api/summary')).body.allTime,{income:0,expenses:2515,balance:-2515});
    await app.close();app=null;
    app=await start(filename);
    assert.equal((await app.request('/api/transactions')).body.items.length,2);
    assert.equal(app.db.prepare("SELECT count(*) count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().count,5);
    assert.equal((await app.request('/api/transactions/'+a.body.id,'DELETE')).status,200);
    assert.deepEqual((await app.request('/api/summary')).body.allTime,{income:0,expenses:2505,balance:-2505});
    assert.equal((await app.request('/api/transactions/'+b.body.id,'DELETE')).status,200);
    assert.deepEqual((await app.request('/api/summary')).body.allTime,{income:0,expenses:0,balance:0});
    assert.equal((await app.request('/api/transactions/999','DELETE')).status,404);
    assert.equal((await app.request('/api/transactions/999','PUT',income)).status,404);
  } finally {if(app) await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('rejects invalid input without inserting records',async()=>{
  const app=await start(':memory:');
  try {
    for(const invalid of [null,[],{},...['0','-1','1.001','1e3','NaN','10000000','00.10'].map(amount=>({...income,amount})),{...income,amount:1},{...income,date:'2026-02-30'},{...income,date:'0000-01-01'},{...income,type:'other'},{...income,category_id:4},{...income,category_id:'1'},{...income,category_id:99},{...income,description:'a'.repeat(251)}]) {
      assert.equal((await app.request('/api/transactions','POST',invalid)).status,400,JSON.stringify(invalid));
    }
    for(const query of ['type=other','category=abc','category=1%20OR%201=1']) assert.equal((await app.request('/api/transactions?'+query)).status,400);
    assert.equal((await fetch(app.url+'/api/transactions',{method:'POST',headers:{'Content-Type':'application/json',Cookie:app.cookie,'X-CSRF-Token':app.csrf},body:'{bad'})).status,400);
    assert.equal((await fetch(app.url+'/api/transactions',{method:'POST',headers:{'Content-Type':'application/json',Cookie:app.cookie,'X-CSRF-Token':app.csrf},body:'x'.repeat(9000)})).status,400);
    assert.equal((await fetch(app.url+'/api/transactions',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://evil.example'},body:JSON.stringify(income)})).status,403);
    assert.equal((await app.request('/api/transactions')).body.items.length,0);
    assert.equal((await app.request('/api/transactions','POST',{...income,date:'2024-02-29',description:'<script>alert(1)</script>'})).status,201);
    assert.throws(()=>app.db.prepare("INSERT INTO transactions(type,amount_cents,date,category_id) VALUES ('expense',1,'2026-10-26',1)").run());
  } finally {await app.close();}
});
