export function validDate(value) {
  return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value>='0001-01-01' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
}
export function filters(params) {
  const clauses=[], values=[];
  const type=params.get('type'), category=params.get('category'), start=params.get('start'), end=params.get('end'), search=params.get('search');
  if(type) {if(!['income','expense'].includes(type)) throw new Error('Invalid type filter.');clauses.push('t.type=?');values.push(type);}
  if(category) {if(!/^[1-9]\d*$/.test(category)||!Number.isSafeInteger(Number(category))) throw new Error('Invalid category filter.');clauses.push('t.category_id=?');values.push(Number(category));}
  for(const [value,operator] of [[start,'>='],[end,'<=']]) if(value) {if(!validDate(value)) throw new Error('Enter a valid filter date.');clauses.push(`t.date${operator}?`);values.push(value);}
  if(start && end && start>end) throw new Error('Start date must be on or before end date.');
  if(search) {if(search.length>250) throw new Error('Search must be 250 characters or fewer.');clauses.push("t.description LIKE ? ESCAPE '\\'");values.push('%'+search.replace(/[\\%_]/g,'\\$&')+'%');}
  return {where:clauses.length?'WHERE '+clauses.join(' AND '):'',values};
}
export function summary(db,where='',values=[]) {
  const row=db.prepare(`SELECT COALESCE(SUM(CASE WHEN t.type='income' THEN amount_cents ELSE 0 END),0) income, COALESCE(SUM(CASE WHEN t.type='expense' THEN amount_cents ELSE 0 END),0) expenses FROM transactions t ${where}`).get(...values);
  return {...row,balance:row.income-row.expenses};
}
export function listTransactions(db,where,values,limit='',paging=[]) {
  return db.prepare(`SELECT t.*,c.name category FROM transactions t JOIN categories c ON c.id=t.category_id ${where} ORDER BY t.date DESC,t.id DESC ${limit}`).all(...values,...paging);
}
function csvCell(value) {
  let text=String(value);
  // Prevent spreadsheet formula execution, including leading control characters.
  if(/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
export function csv(rows) {
  return '\uFEFF'+[['Date','Description','Category','Type','Amount (USD)'],...rows.map(t=>[t.date,t.description,t.category,t.type,(t.amount_cents/100).toFixed(2)])].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
