export function validateInventory(body) {
  if(!body || typeof body!=='object' || Array.isArray(body)) throw new Error('An inventory item is required.');
  if(typeof body.name!=='string' || !body.name.trim() || body.name.trim().length>100) throw new Error('Item name must be 1-100 characters.');
  if(!Number.isSafeInteger(body.quantity) || body.quantity<0 || body.quantity>1000000) throw new Error('Quantity must be a whole number between 0 and 1,000,000.');
  if(typeof body.unit_price!=='string' || !/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(body.unit_price)) throw new Error('Unit price must be between 0.00 and 9,999,999.99 with at most two decimal places.');
  const [whole,fraction='']=body.unit_price.split('.');
  return {name:body.name.trim(),quantity:body.quantity,unit_price_cents:Number(whole)*100+Number(fraction.padEnd(2,'0'))};
}
