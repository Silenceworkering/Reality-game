import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// A single global write lock is deliberately conservative for this small slice.
// Postgres advisory transaction locks work across processes and pooled connections.
export async function openDatabase(database) {
 const postgres=/^postgres(ql)?:\/\//.test(database);
 const context=new AsyncLocalStorage();
 let sqlite,pool;
 if(postgres){const {default:pg}=await import('pg');pg.types.setTypeParser(20,Number);pool=new pg.Pool({connectionString:database,max:5,connectionTimeoutMillis:15000,idleTimeoutMillis:30000});pool.on('error',()=>console.error('Database connection interrupted'));}
 else {if(database!==':memory:')mkdirSync(dirname(resolve(database)),{recursive:true});sqlite=new DatabaseSync(database);sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');}
 let tail=Promise.resolve();
 const exclusive=async fn=>{const previous=tail;let release;tail=new Promise(r=>release=r);await previous;try{return await fn();}finally{release();}};
 const translate=sql=>{if(!postgres)return sql;let n=0;return sql.replace(/\buser\b/g,'"user"').replace(/\?/g,()=>'$'+(++n)).replace(/INSERT OR IGNORE INTO (.*)/i,'INSERT INTO $1 ON CONFLICT DO NOTHING');};
 const execute=async(sql,params=[],mode='run')=>{
  const run=async()=>{if(postgres){const result=await (context.getStore()||pool).query(translate(sql),params);if(mode==='all')return result.rows;if(mode==='get')return result.rows[0];return {lastInsertRowid:result.rows[0]?.id,changes:result.rowCount};}const stmt=sqlite.prepare(sql);return stmt[mode](...params);};
  return postgres||context.getStore()?run():exclusive(run);
 };
 const transaction=async fn=>{
  if(postgres){const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(72836411)');const result=await context.run(client,fn);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
  return exclusive(async()=>{sqlite.exec('BEGIN IMMEDIATE');try{const result=await context.run(true,fn);sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}});
 };
 const db={postgres,transaction,prepare:sql=>Object.fromEntries(['get','all','run'].map(mode=>[mode,(...params)=>execute(sql,params,mode)])),exec:async sql=>{if(postgres)return (context.getStore()||pool).query(translate(sql));sqlite.exec(sql);},close:async()=>{if(pool)await pool.end();else sqlite.close();}};
 return db;
}
