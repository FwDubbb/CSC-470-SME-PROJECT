import { pathToFileURL } from 'node:url';
﻿import { DatabaseSync,backup } from 'node:sqlite';
import { mkdirSync, existsSync, renameSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { initializeAuth } from '../server/auth.js';
import { databasePath,lockDatabase } from '../server/storage.js';
export function validateBackup(db) {
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok') throw new Error('Backup integrity check failed.');
  const required={categories:['id','name','type'],transactions:['id','type','amount_cents','date','category_id','description']};
  for(const [table,columns] of Object.entries(required)) {
    const actual=db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name);
    if(!columns.every(column=>actual.includes(column))) throw new Error('Not a compatible finance tracker backup.');
  }
  if(db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Backup contains broken database relationships.');
}
export async function makeBackup(source,target) {
  const db=new DatabaseSync(source,{readOnly:true});
  try{validateBackup(db);await backup(db,target);}finally{db.close();}
}
export async function restoreBackup(source,target,priorBackup) {
  if(resolve(source)===resolve(target)) throw new Error('Select a backup file different from the active database.');
  const staged=target+'.restore-'+randomBytes(6).toString('hex');
  try {
    await makeBackup(source,staged);
    const restored=new DatabaseSync(staged);
    try{initializeAuth(restored);restored.exec('DELETE FROM sessions; DELETE FROM login_limits; PRAGMA journal_mode=DELETE;');}finally{restored.close();}
    if(existsSync(target)) {
      await makeBackup(target,priorBackup);
      const current=new DatabaseSync(target);try{current.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;');}finally{current.close();}
    }
    renameSync(staged,target);
  }finally{rmSync(staged,{force:true});}
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  let unlock;
  try {
    unlock=lockDatabase(databasePath);
    const folder=join(dirname(databasePath),'backups');mkdirSync(folder,{recursive:true});
    const suffix=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(3).toString('hex');
    if(process.argv[2]==='backup') {
      const target=join(folder,`finance-${suffix}.sqlite`);await makeBackup(databasePath,target);console.log('Backup saved:',target);
    } else if(process.argv[2]==='restore' && process.argv[3]) {
      const prior=join(folder,`before-restore-${suffix}.sqlite`);await restoreBackup(resolve(process.argv[3]),databasePath,prior);
      console.log('Backup restored. Previous database preserved if present:',prior);console.log('Sessions revoked. Sign in with the credentials stored in the backup, or use npm run account:reset.');
    } else throw new Error('Use npm run backup or npm run restore -- "path/to/backup.sqlite".');
  }catch(error){console.error(error.message);process.exitCode=1;}finally{unlock?.();}
}
