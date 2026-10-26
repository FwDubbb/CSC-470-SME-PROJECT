import { openSync, writeSync, closeSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export const databasePath=process.env.DB_PATH || fileURLToPath(new URL('../data/finance.sqlite',import.meta.url));
export function lockDatabase(filename) {
  mkdirSync(dirname(filename),{recursive:true});
  const lock=filename+'.lock';
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const handle=openSync(lock,'wx');writeSync(handle,String(process.pid));closeSync(handle);
      return ()=>{try{unlinkSync(lock);}catch(error){if(error.code!=='ENOENT') throw error;}};
    } catch(error) {
      if(error.code!=='EEXIST') throw error;
      let pid;
      try {pid=Number(readFileSync(lock,'utf8'));}catch{throw new Error('Database is locked. Stop the app before maintenance.');}
      if(!Number.isSafeInteger(pid)||pid<1) throw new Error('Invalid database lock; check that the app is stopped before removing the .lock file.');
      try {process.kill(pid,0);}catch(checkError){if(checkError.code==='ESRCH'){try{unlinkSync(lock);}catch{}continue;}}
      throw new Error('Database is in use. Stop the app before running account setup, backup, or restore.');
    }
  }
  throw new Error('Unable to acquire database lock.');
}
