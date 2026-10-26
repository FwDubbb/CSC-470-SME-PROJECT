import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openDatabase, validateTransaction } from './db.js';

const publicDirectory = new URL('../public/', import.meta.url);
const files = { '/': ['index.html','text/html'], '/app.js': ['app.js','text/javascript'], '/styles.css': ['styles.css','text/css'] };
function respond(res, status, body) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store' });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('Send JSON data.');
  let body = '';
  for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body)>8192) throw new Error('Request is too large.'); }
  try { return JSON.parse(body); } catch { throw new Error('Invalid JSON.'); }
}
export function createApp(filename) {
  const db = openDatabase(filename);
  const server = createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    try {
      const url = new URL(req.url,'http://localhost');
      // Browser mutations must originate from this app (no authentication is intended).
      if (['POST','PUT','DELETE'].includes(req.method) && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return respond(res,403,{error:'Cross-origin changes are not allowed.'});
      if (req.method==='GET' && files[url.pathname]) {
        const [name,type] = files[url.pathname];
        const content = await readFile(new URL(name,publicDirectory));
        res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`}); return res.end(content);
      }
      if (req.method==='GET' && url.pathname==='/api/categories') return respond(res,200,db.prepare('SELECT * FROM categories ORDER BY id').all());
      if (req.method==='GET' && url.pathname==='/api/summary') {
        const totals = db.prepare("SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount_cents ELSE 0 END),0) income, COALESCE(SUM(CASE WHEN type='expense' THEN amount_cents ELSE 0 END),0) expenses FROM transactions").get();
        return respond(res,200,{...totals,balance:totals.income-totals.expenses});
      }
      if (req.method==='GET' && url.pathname==='/api/transactions') {
        const clauses=[], values=[];
        const type=url.searchParams.get('type'), category=url.searchParams.get('category');
        if(type) { if(!['income','expense'].includes(type)) return respond(res,400,{error:'Invalid type filter.'}); clauses.push('t.type=?'); values.push(type); }
        if(category) { if(!/^[1-9]\d*$/.test(category) || !Number.isSafeInteger(Number(category))) return respond(res,400,{error:'Invalid category filter.'}); clauses.push('t.category_id=?'); values.push(Number(category)); }
        return respond(res,200,db.prepare(`SELECT t.*, c.name category FROM transactions t JOIN categories c ON c.id=t.category_id ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY date DESC,t.id DESC`).all(...values));
      }
      const match=url.pathname.match(/^\/api\/transactions\/([1-9]\d*)$/);
      if ((req.method==='POST' && url.pathname==='/api/transactions') || (req.method==='PUT' && match)) {
        const body=await readBody(req);
        const t=validateTransaction(body,db);
        if(match) {
          const result=db.prepare('UPDATE transactions SET type=?,amount_cents=?,date=?,category_id=?,description=? WHERE id=?').run(t.type,t.amount_cents,t.date,t.category_id,t.description,Number(match[1]));
          return respond(res,result.changes?200:404,result.changes?{id:Number(match[1]),...t}:{error:'Transaction not found.'});
        }
        const result=db.prepare('INSERT INTO transactions(type,amount_cents,date,category_id,description) VALUES (?,?,?,?,?)').run(t.type,t.amount_cents,t.date,t.category_id,t.description);
        return respond(res,201,{id:Number(result.lastInsertRowid),...t});
      }
      if (req.method==='DELETE' && match) {
        const result=db.prepare('DELETE FROM transactions WHERE id=?').run(Number(match[1]));
        return respond(res,result.changes?200:404,result.changes?{message:'Transaction deleted.'}:{error:'Transaction not found.'});
      }
      respond(res,404,{error:'Not found.'});
    } catch(error) {
      if(error.code?.startsWith('ERR_SQLITE') || error.code==='ENOENT') { console.error(error); respond(res,500,{error:'Unable to access application data. Please retry.'}); }
      else respond(res,400,{error:error.message || 'Invalid request.'});
    }
  });
  return { server, db };
}
if (process.argv[1] && fileURLToPath(import.meta.url)===fileURLToPath(new URL(`file:///${process.argv[1].replaceAll('\\','/')}`))) {
  const {server,db}=createApp(process.env.DB_PATH || fileURLToPath(new URL('../data/finance.sqlite',import.meta.url)));
  const port=Number(process.env.PORT || 3000);
  server.listen(port,'127.0.0.1',()=>console.log(`Finance Tracker: http://localhost:${port}`));
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{db.close();process.exit(0)}));
}
