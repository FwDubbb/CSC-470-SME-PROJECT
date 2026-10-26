import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';
import { openDatabase } from '../server/db.js';
import { initializeAuth,setOwner } from '../server/auth.js';
import { databasePath,lockDatabase } from '../server/storage.js';
async function secret(question) {
  if(!stdin.isTTY) throw new Error('Use an interactive terminal to enter a password securely.');
  stdout.write(question);
  const sink=new Writable({write(chunk,encoding,callback){callback();}});
  const prompt=createInterface({input:stdin,output:sink,terminal:true});
  try{return await prompt.question('');}finally{prompt.close();stdout.write('\n');}
}
let unlock,db;
try {
  unlock=lockDatabase(databasePath);db=openDatabase(databasePath);initializeAuth(db);
  const reset=process.argv.includes('--reset');
  if(!reset && db.prepare('SELECT id FROM users').get()) throw new Error('Owner already configured. Use npm run account:reset instead.');
  const prompt=createInterface({input:stdin,output:stdout});
  let username;try{username=await prompt.question('Owner username (3–40 letters, digits, dots, underscores, hyphens): ');}finally{prompt.close();}
  const password=await secret('Password (15–128 characters; input hidden): ');
  const confirmation=await secret('Confirm password: ');
  if(password!==confirmation) throw new Error('Passwords do not match.');
  await setOwner(db,username.trim(),password,reset);
  console.log('Owner credentials saved. Existing sessions revoked. Run npm start to sign in.');
} catch(error){console.error(error.message);process.exitCode=1;}finally{db?.close();unlock?.();}
