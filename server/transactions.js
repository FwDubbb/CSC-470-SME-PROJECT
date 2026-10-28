import { validateTransaction } from './db.js';
function fail(message,status=400) {const error=new Error(message);error.status=status;throw error;}
function restoreStock(db,userId,transaction) {
  if(!transaction?.inventory_id)return;
  const item=db.prepare('SELECT quantity FROM inventory WHERE id=? AND user_id=?').get(transaction.inventory_id,userId);
  if(!item)fail('The linked inventory item no longer exists.',409);
  if(item.quantity+transaction.sale_quantity>1000000)fail('Restoring this sale would exceed the stock limit. Adjust inventory first.',409);
  db.prepare('UPDATE inventory SET quantity=quantity+? WHERE id=? AND user_id=?').run(transaction.sale_quantity,transaction.inventory_id,userId);
}
export function saveTransaction(db,userId,body,id=null) {
  if(!body || typeof body!=='object' || Array.isArray(body))fail('A transaction object is required.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing=id?db.prepare('SELECT * FROM transactions WHERE id=? AND user_id=?').get(id,userId):null;
    if(id && !existing)fail('Transaction not found.',404);
    if(existing?.inventory_id && !Object.hasOwn(body,'inventory_id'))fail('Use the sale form to edit this inventory sale.');
    restoreStock(db,userId,existing);
    let transaction,inventoryId=null,quantity=null,price=null,itemName=null;
    if(body.inventory_id!==undefined && body.inventory_id!==null) {
      inventoryId=body.inventory_id;quantity=body.quantity;
      if(!Number.isSafeInteger(inventoryId)||inventoryId<1)fail('Select an inventory item.');
      if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)fail('Sale quantity must be a whole number between 1 and 1,000,000.');
      const item=db.prepare('SELECT * FROM inventory WHERE id=? AND user_id=?').get(inventoryId,userId);
      if(!item)fail('Inventory item not found.',404);
      if(quantity>item.quantity)fail(`Not enough stock. Only ${item.quantity} available.`,409);
      if(body.type!==undefined && body.type!=='income')fail('Inventory sales must be income.');
      const text=body.unit_price===undefined?((existing?.inventory_id===inventoryId?existing.sale_unit_price_cents:item.unit_price_cents)/100).toFixed(2):body.unit_price;
      if(typeof text!=='string'||!/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(text))fail('Enter a positive sale unit price with at most two decimal places.');
      const [whole,fraction='']=text.split('.');price=Number(whole)*100+Number(fraction.padEnd(2,'0'));
      const total=price*quantity;
      if(price<1||total>999999999)fail('Sale total must be between 0.01 and 9,999,999.99.');
      const category=db.prepare("SELECT id FROM categories WHERE name='Sales' AND type='income'").get();
      if(!category)fail('The Sales category is unavailable.',409);
      itemName=existing?.inventory_id===inventoryId?existing.sale_item_name:item.name;
      const description=body.description===undefined || body.description==='' || (existing?.inventory_id && body.description===existing.description && existing.description===`Sold ${existing.sale_quantity} x ${existing.sale_item_name}`)?`Sold ${quantity} x ${itemName}`:body.description;
      transaction=validateTransaction({type:'income',amount:(total/100).toFixed(2),date:body.date,category_id:category.id,description},db);
      const stock=db.prepare('UPDATE inventory SET quantity=quantity-? WHERE id=? AND user_id=? AND quantity>=?').run(quantity,inventoryId,userId,quantity);
      if(!stock.changes)fail('Stock changed. Reload and try again.',409);
    } else transaction=validateTransaction(body,db);
    const values=[transaction.type,transaction.amount_cents,transaction.date,transaction.category_id,transaction.description,inventoryId,quantity,price,itemName];
    if(id)db.prepare('UPDATE transactions SET type=?,amount_cents=?,date=?,category_id=?,description=?,inventory_id=?,sale_quantity=?,sale_unit_price_cents=?,sale_item_name=? WHERE id=? AND user_id=?').run(...values,id,userId);
    else id=Number(db.prepare('INSERT INTO transactions(type,amount_cents,date,category_id,description,inventory_id,sale_quantity,sale_unit_price_cents,sale_item_name,user_id) VALUES (?,?,?,?,?,?,?,?,?,?)').run(...values,userId).lastInsertRowid);
    const result=db.prepare('SELECT * FROM transactions WHERE id=? AND user_id=?').get(id,userId);
    db.exec('COMMIT');return result;
  }catch(error){db.exec('ROLLBACK');throw error;}
}
export function deleteTransaction(db,userId,id) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing=db.prepare('SELECT * FROM transactions WHERE id=? AND user_id=?').get(id,userId);
    if(!existing)fail('Transaction not found.',404);
    restoreStock(db,userId,existing);
    db.prepare('DELETE FROM transactions WHERE id=? AND user_id=?').run(id,userId);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
