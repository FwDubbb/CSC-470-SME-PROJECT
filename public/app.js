const $ = (id) => document.getElementById(id);
const form = $('transaction-form');
const money = (cents) => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(cents/100);
let categories=[], records=[], editingId=null, requestVersion=0, mutating=false;
function message(text,error=false) { $('message').textContent=text; $('message').className=error?'error':''; }
async function api(path,options={}) {
  const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers}});
  const body=await response.json();
  if(!response.ok) throw new Error(body.error || 'Something went wrong. Please retry.');
  return body;
}
function fillCategories() {
  const current=$('category').value;
  $('category').replaceChildren(...categories.filter(c=>c.type===form.elements.type.value).map(c=>new Option(c.name,c.id)));
  if([...$('category').options].some(o=>o.value===current)) $('category').value=current;
}
function resetForm() {
  editingId=null; form.reset();
  const today=new Date();
  $('date').value=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  fillCategories(); $('form-title').textContent='Add a transaction'; $('save').textContent='Add transaction'; $('cancel').hidden=true;
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
    for(const [label,handler] of [['Edit',()=>edit(record)],['Delete',()=>remove(record)]]) {
      const button=document.createElement('button'); button.type='button';button.textContent=label;button.className=label==='Delete'?'delete':'';button.disabled=mutating;
      button.setAttribute('aria-label',`${label} ${record.description || record.category}, ${money(record.amount_cents)}, ${record.date}`);
      button.addEventListener('click',handler);actions.append(button);
    }
    actionCell.append(actions);
    row.append(detail,cell(record.category),type,cell((record.type==='income'?'+':'−')+money(record.amount_cents),`money ${record.type==='income'?'income-money':''}`),actionCell);
    $('transactions').append(row);
  }
  $('count').textContent=`${records.length} record${records.length===1?'':'s'}`;
  $('empty').hidden=records.length>0;
}
async function refresh() {
  const version=++requestVersion;
  const query=new URLSearchParams();
  if($('filter-type').value) query.set('type',$('filter-type').value);
  if($('filter-category').value) query.set('category',$('filter-category').value);
  const [rows,totals]=await Promise.all([api('/api/transactions?'+query),api('/api/summary')]);
  if(version!==requestVersion) return;
  records=rows;render();
  for(const name of ['income','expenses','balance']) $(name).textContent=money(totals[name]);
  $('retry').hidden=true;
}
async function load() { try { await refresh(); } catch(error) { message('Could not refresh records: '+error.message,true);$('retry').hidden=false; } }
function edit(record) {
  if(mutating) return;
  editingId=record.id;form.elements.type.value=record.type;fillCategories();
  $('amount').value=(record.amount_cents/100).toFixed(2);$('date').value=record.date;$('category').value=record.category_id;$('description').value=record.description;
  $('form-title').textContent='Edit transaction';$('save').textContent='Save changes';$('cancel').hidden=false;
  form.scrollIntoView({behavior:'instant',block:'center'});$('amount').focus();
}
function busy(value) { mutating=value;$('entry-fields').disabled=value;render(); }
async function remove(record) {
  if(mutating) return;
  const dialog=$('delete-dialog');dialog.returnValue='cancel';dialog.showModal();
  const confirmed=await new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='delete'),{once:true}));
  if(!confirmed) return;
  busy(true);
  try {
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
for(const id of ['filter-type','filter-category']) $(id).addEventListener('change',load);
$('retry').addEventListener('click',initialize);
async function initialize() {
  $('entry-fields').disabled=true;
  try {
    categories=await api('/api/categories');
    const selected=$('filter-category').value;
    $('filter-category').replaceChildren(new Option('All categories',''),...categories.map(c=>new Option(c.name,c.id)));
    $('filter-category').value=selected;resetForm();await refresh();$('entry-fields').disabled=false;message('');
  } catch(error) { message('Unable to load finance tracker. '+error.message,true);$('retry').hidden=false; }
}
await initialize();
