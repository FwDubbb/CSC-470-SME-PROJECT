import { createInventory } from './inventory.js';
﻿const $ = (id) => document.getElementById(id);
const form = $('transaction-form');
const money = (cents) => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(cents/100);
let categories=[], records=[], editingId=null, requestVersion=0, mutating=false;
let csrfToken=null, page=1, total=0, authenticated=false, signupMode=false;
function message(text,error=false) { $('message').textContent=text; $('message').className=error?'error':''; }
async function api(path,options={}) {
  const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(csrfToken?{'X-CSRF-Token':csrfToken}:{}),...options.headers}});
  const body=await response.json();
  if(response.status===401 && !path.includes('/auth/login')) showLogin('Your session ended. Please sign in again.');
  if(!response.ok) throw new Error(body.error || 'Something went wrong. Please retry.');
  return body;
}
const inventory=createInventory({api,money});
function fillCategories() {
  const current=$('category').value;
  $('category').replaceChildren(...categories.filter(c=>c.type===form.elements.type.value).map(c=>new Option(c.name,c.id)));
  if([...$('category').options].some(o=>o.value===current)) $('category').value=current;
}
function resetForm() {
  editingId=null; form.reset();
  const today=new Date();
  $('date').value=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  fillCategories(); $('form-title').textContent='New entry'; $('save').textContent='Add transaction'; $('cancel').hidden=true;
}
function cell(text,className='') { const el=document.createElement('td');el.textContent=text;el.className=className;return el; }
function render() {
  $('transactions').replaceChildren();
  for(const record of records) {
    const row=document.createElement('tr');
    const detail=cell('');
    const description=document.createElement('span');description.className='description';description.textContent=record.description || 'No description';description.title=description.textContent;
    const date=document.createElement('span');date.className='date';date.textContent=new Date(record.date+'T12:00:00').toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});
    detail.append(description,date);
    const type=cell(''); const badge=document.createElement('span');badge.className=`badge ${record.type}`;badge.textContent=record.type==='income'?'Income':'Expense';type.append(badge);
    const actionCell=cell(''); const actions=document.createElement('div');actions.className='actions';
    for(const [label,handler] of [['Edit',()=>edit(record)],['Duplicate',()=>duplicate(record)],['Delete',()=>remove(record)]]) {
      const button=document.createElement('button'); button.type='button';button.textContent=label;button.className=label==='Delete'?'delete':'';button.disabled=mutating;
      button.setAttribute('aria-label',`${label} ${record.description || record.category}, ${money(record.amount_cents)}, ${record.date}`);
      button.addEventListener('click',handler);actions.append(button);
    }
    actionCell.append(actions);
    row.append(detail,cell(record.category),type,cell((record.type==='income'?'+':'−')+money(record.amount_cents),`money ${record.type==='income'?'income-money':''}`),actionCell);
    $('transactions').append(row);
  }
  $('count').textContent=`${total} record${total===1?'':'s'}`;
  $('empty').hidden=records.length>0;
}
function currentFilters() {
  const query=new URLSearchParams();
  for(const [id,key] of [['filter-type','type'],['filter-category','category'],['filter-start','start'],['filter-end','end'],['filter-search','search']]) if($(id).value) query.set(key,$(id).value);
  return query;
}
async function refresh() {
  const version=++requestVersion;
  const query=currentFilters();query.set('page',page);query.set('pageSize',$('page-size').value);
  const [result,totals]=await Promise.all([api('/api/transactions?'+query),api('/api/summary?'+query)]);
  if(version!==requestVersion || !authenticated) return;
  records=result.items;total=result.total;page=result.page;render();
  for(const name of ['income','expenses','balance']) {
    $(name).textContent=money(totals.allTime[name]);$('filtered-'+name).textContent=money(totals.filtered[name]);
  }
  const pages=Math.max(1,Math.ceil(total/result.pageSize));
  $('page-info').textContent='Page '+page+' of '+pages;
  $('previous-page').disabled=page<=1;$('next-page').disabled=page>=pages;
  $('retry').hidden=true;
}
async function load() { try { await refresh(); } catch(error) { message('Could not refresh records: '+error.message,true);$('retry').hidden=false; } }
function edit(record) {
  if(mutating) return;
  editingId=record.id;form.elements.type.value=record.type;fillCategories();
  $('amount').value=(record.amount_cents/100).toFixed(2);$('date').value=record.date;$('category').value=record.category_id;$('description').value=record.description;
  $('form-title').textContent='Update entry';$('save').textContent='Save changes';$('cancel').hidden=false;
  form.scrollIntoView({behavior:'instant',block:'center'});$('amount').focus();
}
function duplicate(record) {
  edit(record);editingId=null;$('form-title').textContent='Make it another';$('save').textContent='Add duplicate';
  message('Review the date and details, then save as a new transaction.');
}
function busy(value) { mutating=value;$('entry-fields').disabled=value;render(); }
async function remove(record) {
  if(mutating) return;
  busy(true);
  try {
    const dialog=$('delete-dialog');dialog.returnValue='cancel';dialog.showModal();
    const confirmed=await new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='delete'),{once:true}));
    if(!confirmed) return;
    await api('/api/transactions/'+record.id,{method:'DELETE'});
    if(editingId===record.id) resetForm();
    message('Transaction deleted.');await load();
  } catch(error) { message(error.message,true); }
  finally {busy(false);}
}
form.addEventListener('submit',async event=>{
  event.preventDefault();if(mutating || !form.reportValidity()) return;
  const wasEditing=editingId;
  const payload={type:form.elements.type.value,amount:$('amount').value,date:$('date').value,category_id:Number($('category').value),description:$('description').value};
  busy(true);
  try {
    await api('/api/transactions'+(wasEditing?'/'+wasEditing:''),{method:wasEditing?'PUT':'POST',body:JSON.stringify(payload)});
    resetForm();message(wasEditing?'Transaction updated.':'Transaction added.');await load();
  } catch(error) { message(error.message,true); }
  finally {busy(false);}
});
for(const radio of form.elements.type) radio.addEventListener('change',fillCategories);
$('cancel').addEventListener('click',resetForm);
for(const id of ['filter-type','filter-category','filter-start','filter-end','page-size']) $(id).addEventListener('change',()=>{page=1;if(id==='filter-start'||id==='filter-end') $('period').value='';void load();});
let searchTimer;
$('filter-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{page=1;void load();},300);});
$('retry').addEventListener('click',initialize);
async function initialize() {
  $('entry-fields').disabled=true;
  try {
    categories=await api('/api/categories');
    await inventory.load();
    const selected=$('filter-category').value;
    $('filter-category').replaceChildren(new Option('All categories',''),...categories.map(c=>new Option(c.name,c.id)));
    $('filter-category').value=selected;resetForm();await refresh();$('entry-fields').disabled=false;message('');
  } catch(error) { message('Unable to load finance tracker. '+error.message,true);$('retry').hidden=false; }
}
function setAuthMode(createAccount) {
  signupMode=createAccount;
  $('auth-title').textContent=createAccount?'A fresh start, right here.':'Back to business.';
  $('auth-subtitle').textContent=createAccount?'Create your account and make yourself at home.':'Sign in and pick up where you left off.';
  $('login-button').textContent=createAccount?'Create account':'Sign in';
  $('password').minLength=createAccount?15:0;
  $('password').autocomplete=createAccount?'new-password':'current-password';
  $('signup-confirm').hidden=!createAccount;
  $('signup-confirm-password').disabled=!createAccount;
  $('signup-confirm-password').required=createAccount;
  $('setup-note').hidden=!createAccount;
}
function showLogin(text='') {
  inventory.clear();
  document.body.classList.remove('is-authenticated');$('auth-layout').hidden=false;
  authenticated=false;csrfToken=null;requestVersion++;clearTimeout(searchTimer);
  records=[];total=0;editingId=null;render();form.reset();
  for(const name of ['income','expenses','balance']) {$(name).textContent='\u2014';$('filtered-'+name).textContent='\u2014';}
  $('finance-view').hidden=true;$('account-controls').hidden=true;$('login-view').hidden=false;
  $('delete-dialog').close();$('password-dialog').close();$('password-form').reset();
  $('login-message').textContent=text;$('password').value='';$('signup-confirm-password').value='';
}
async function signedIn(status) {
  document.body.classList.add('is-authenticated');$('auth-layout').hidden=true;
  authenticated=true;csrfToken=status.csrfToken;page=1;
  document.querySelector('.owner-avatar').textContent=status.username.slice(0,1).toUpperCase();
  $('login-view').hidden=true;$('finance-view').hidden=false;$('account-controls').hidden=false;$('owner-name').textContent=status.username;
  await initialize();
}
$('login-form').addEventListener('submit',async event=>{
  event.preventDefault();$('login-button').disabled=true;$('login-message').textContent='';
  try {
    if(signupMode && $('password').value!==$('signup-confirm-password').value) throw new Error('Passwords do not match.');
    const result=await api(signupMode?'/api/auth/signup':'/api/auth/login',{method:'POST',body:JSON.stringify({username:$('username').value,password:$('password').value,...(signupMode?{confirmPassword:$('signup-confirm-password').value}:{})})});
    $('password').value='';$('signup-confirm-password').value='';setAuthMode(false);await signedIn(result);
  }
  catch(error){
    if(signupMode) {try{const status=await api('/api/auth/status');if(status.configured)setAuthMode(false);}catch{}}
    $('login-message').textContent=error.message;
  }
  finally{$('login-button').disabled=false;}
});
$('logout').addEventListener('click',async()=>{
  if(mutating) return;
  try{await api('/api/auth/logout',{method:'POST',body:'{}'});showLogin('Signed out.');}
  catch(error){message(error.message,true);}
});
$('change-password').addEventListener('click',()=>{$('password-form').reset();$('password-message').textContent='';$('password-dialog').showModal();});
$('password-cancel').addEventListener('click',()=>$('password-dialog').close());
$('password-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if($('new-password').value!==$('confirm-password').value){$('password-message').textContent='Passwords do not match.';return;}
  $('password-save').disabled=true;
  try{await api('/api/auth/password',{method:'POST',body:JSON.stringify({currentPassword:$('current-password').value,newPassword:$('new-password').value})});showLogin('Password changed. Please sign in again.');}
  catch(error){$('password-message').textContent=error.message;}
  finally{$('password-save').disabled=false;}
});
$('previous-page').addEventListener('click',()=>{page=Math.max(1,page-1);void load();});
$('next-page').addEventListener('click',()=>{page++;void load();});
$('clear-filters').addEventListener('click',()=>{for(const id of ['filter-type','filter-category','filter-start','filter-end','filter-search','period']) $(id).value='';page=1;void load();});
function dateString(value){return value.getFullYear()+'-'+String(value.getMonth()+1).padStart(2,'0')+'-'+String(value.getDate()).padStart(2,'0');}
$('period').addEventListener('change',()=>{
  const now=new Date(),year=now.getFullYear(),month=now.getMonth(),choice=$('period').value;
  if(!choice){$('filter-start').value='';$('filter-end').value='';}
  else {
    const start=choice==='year'?new Date(year,0,1):new Date(year,choice==='last-month'?month-1:month,1);
    const end=choice==='year'?new Date(year,11,31):new Date(year,choice==='last-month'?month:month+1,0);
    $('filter-start').value=dateString(start);$('filter-end').value=dateString(end);
  }
  page=1;void load();
});
$('export').addEventListener('click',async()=>{
  $('export').disabled=true;
  try {
    const response=await fetch('/api/export?'+currentFilters());
    if(!response.ok){const body=await response.json();if(response.status===401)showLogin('Please sign in again.');throw new Error(body.error);}
    const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='ledger-transactions.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    message('CSV exported for all matching transactions.');
  } catch(error){message(error.message,true);}finally{$('export').disabled=false;}
});
try {
  const status=await api('/api/auth/status');setAuthMode(!status.configured);
  if(status.authenticated) await signedIn(status);else showLogin();
} catch(error){showLogin('Unable to connect. Refresh the page to retry.');}
finally { $('login-button').disabled=false; }

$('today-label').textContent=new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric'}).format(new Date());
for(const link of document.querySelectorAll('.section-nav a')) link.addEventListener('click',()=>{for(const item of document.querySelectorAll('.section-nav a'))item.classList.toggle('active',item===link);});
