export function createInventory({api,money}) {
  const $=id=>document.getElementById(id);
  let items=[],editingId=null,mutating=false,generation=0;
  const notice=(text,error=false)=>{$('inventory-message').textContent=text;$('inventory-message').className=error?'error':'';};
  function resetForm() {
    editingId=null;$('inventory-form').reset();$('inventory-form-title').textContent='Add an item';$('inventory-save').textContent='Add item';$('inventory-cancel').hidden=true;
  }
  function render() {
    const term=$('inventory-search').value.trim().toLowerCase();
    const matches=items.filter(item=>item.name.toLowerCase().includes(term));
    $('inventory-items').replaceChildren();$('inventory-count').textContent=matches.length+' of '+items.length+' items';
    $('inventory-empty').hidden=matches.length>0;
    $('inventory-empty').querySelector('h3').textContent=items.length?'No matching items.':'No items yet.';
    $('inventory-empty').querySelector('p').textContent=items.length?'Try a different item name.':'Add your first item to start tracking stock.';
    for(const item of matches) {
      const row=document.createElement('tr');
      for(const value of [item.name,item.quantity,money(item.unit_price_cents)]) {const cell=document.createElement('td');cell.textContent=value;row.append(cell);}
      const status=document.createElement('td'),badge=document.createElement('span');badge.className='badge'+(item.quantity===0?' expense':'');badge.textContent=item.quantity===0?'Out of stock':'In stock';status.append(badge);row.append(status);
      const cell=document.createElement('td'),actions=document.createElement('div');actions.className='actions';
      for(const [label,handler] of [['Edit',()=>edit(item)],['Delete',()=>remove(item)]]) {
        const button=document.createElement('button');button.type='button';button.textContent=label;button.className=label==='Delete'?'delete':'';button.disabled=mutating;button.setAttribute('aria-label',label+' inventory item '+item.name);button.addEventListener('click',handler);actions.append(button);
      }
      cell.append(actions);row.append(cell);$('inventory-items').append(row);
    }
  }
  function busy(value) {mutating=value;$('inventory-fields').disabled=value;render();}
  async function refresh() {
    const version=++generation;
    const result=await api('/api/inventory');
    if(version!==generation) return;
    items=result;render();$('inventory-retry').hidden=true;
  }
  async function load() {try{await refresh();}catch(error){notice('Could not refresh inventory: '+error.message,true);$('inventory-retry').hidden=false;}}
  function edit(item) {
    if(mutating)return;
    editingId=item.id;$('item-name').value=item.name;$('item-quantity').value=item.quantity;$('item-price').value=(item.unit_price_cents/100).toFixed(2);
    $('inventory-form-title').textContent='Edit item';$('inventory-save').textContent='Save item';$('inventory-cancel').hidden=false;
    $('inventory-form').scrollIntoView({block:'center'});$('item-quantity').focus();
  }
  async function remove(item) {
    if(mutating)return;busy(true);
    try {
      const dialog=$('inventory-delete-dialog');dialog.returnValue='cancel';$('inventory-delete-name').textContent=item.name;dialog.showModal();
      const confirmed=await new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='delete'),{once:true}));
      if(!confirmed)return;
      await api('/api/inventory/'+item.id,{method:'DELETE'});
      if(editingId===item.id)resetForm();notice('Item deleted.');await load();
    }catch(error){notice(error.message,true);}finally{busy(false);}
  }
  $('inventory-form').addEventListener('submit',async event=>{
    event.preventDefault();if(mutating || !$('inventory-form').reportValidity())return;
    const id=editingId,payload={name:$('item-name').value,quantity:Number($('item-quantity').value),unit_price:$('item-price').value};busy(true);
    try {await api('/api/inventory'+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(payload)});resetForm();notice(id?'Item updated.':'Item added.');await load();}
    catch(error){notice(error.message,true);}finally{busy(false);}
  });
  $('inventory-cancel').addEventListener('click',resetForm);$('inventory-search').addEventListener('input',render);$('inventory-retry').addEventListener('click',load);
  return {load,clear(){generation++;items=[];resetForm();$('inventory-search').value='';$('inventory-delete-dialog').close();notice('');render();}};
}
