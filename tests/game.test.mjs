import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGame } from '../apps/server/server.mjs';
import { validName, allowedApartment } from '../packages/shared/game.mjs';

async function setup(t, database) {
 const game=await createGame({database});await new Promise(r=>game.server.listen(0,'127.0.0.1',r));
 t.after(()=>game.close());const base=`http://127.0.0.1:${game.server.address().port}`;
 const client=()=>{let cookie='';return async(path,body,headers={})=>{const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),Cookie:cookie,...headers},body:body?JSON.stringify(body):undefined});if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return {status:response.status,data:await response.json(),headers:response.headers};};};return {game,base,client};
}
const account=(name='Сосед')=>({name,password:'strong-password-123'});
test('names and ownership reject forged input',()=>{assert.equal(validName('<script>'),false);assert.equal(validName('Сосед'),true);assert.equal(allowedApartment(1,2),false);});
test('real user journey: registration, dialogue, purchase, placement, relogin',async t=>{
 const {client}=await setup(t);const request=client();
 let result=await request('/api/v1/auth/register',account());assert.equal(result.status,200);assert.equal(result.data.wallet,5000);assert.equal(result.data.apartment,1);assert.match(result.headers.get('set-cookie'),/HttpOnly/);
 assert.equal((await request('/api/v1/action',{type:'dialogue',choice:'plumber',key:'early-000'})).status,409);
 for(const choice of ['hello','zero','plumber'])assert.equal((await request('/api/v1/action',{type:'dialogue',choice,key:'story-'+choice})).status,200);
 const bought=await request('/api/v1/action',{type:'buy-sofa',key:'purchase-001',price:1,user:999});assert.equal(bought.data.wallet,2500);assert.equal(bought.data.layout.sofa,'left');
 const repeated=await request('/api/v1/action',{type:'buy-sofa',key:'purchase-001'});assert.deepEqual(repeated.data,bought.data);
 assert.equal((await request('/api/v1/action',{type:'buy-sofa',key:'purchase-002'})).status,409);
 assert.equal((await request('/api/v1/action',{type:'move-sofa',key:'move-0001',position:'right',user:999})).data.layout.sofa,'right');
 assert.equal((await request('/api/v1/action',{type:'move-sofa',key:'move-0002',position:'outside'})).status,400);
 await request('/api/v1/auth/logout',{});assert.equal((await request('/api/v1/me')).status,401);
 result=await request('/api/v1/auth/login',account());assert.equal(result.data.layout.sofa,'right');assert.equal(result.data.history.length,3);assert.equal(result.data.ledger.length,2);
});
test('separate accounts, replay races, and protected mutations',async t=>{
 const {client}=await setup(t);const a=client(),b=client();await a('/api/v1/auth/register',account('Первый'));await b('/api/v1/auth/register',account('Второй'));
 assert.equal((await b('/api/v1/me')).data.apartment,2);
 const results=await Promise.all(Array.from({length:8},()=>a('/api/v1/action',{type:'buy-sofa',key:'concurrent-buy'})));
 assert.ok(results.every(r=>r.status===200&&r.data.wallet===2500));assert.equal((await a('/api/v1/me')).data.ledger.length,2);
 assert.equal((await b('/api/v1/me')).data.wallet,5000);
 assert.equal((await a('/api/v1/action',{type:'move-sofa',position:'left',key:'csrf-test1'},{Origin:'https://evil.example'})).status,403);
 assert.equal((await client()('/api/v1/action',{type:'buy-sofa',key:'unauth-01'})).status,401);
 assert.equal((await client()('/api/v1/auth/login',{name:'Первый',password:'wrong-password'})).status,401);
 assert.equal((await a('/api/v1/action',{type:'dialogue',choice:'__proto__',key:'invalid-01'})).status,400);
});
test('data survives database reopen',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'nu-zhivi-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const path=join(directory,'game.sqlite');
 let game=await createGame({database:path});await new Promise(r=>game.server.listen(0,'127.0.0.1',r));let base=`http://127.0.0.1:${game.server.address().port}`;
 await fetch(base+'/api/v1/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(account('Долгожитель'))});await game.close();
 game=await createGame({database:path});await new Promise(r=>game.server.listen(0,'127.0.0.1',r));t.after(()=>game.close());base=`http://127.0.0.1:${game.server.address().port}`;
 const response=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(account('Долгожитель'))});assert.equal(response.status,200);assert.equal((await response.json()).wallet,5000);
});
test('auth throttling, malformed requests, and health',async t=>{
 const {client,base}=await setup(t);const request=client();assert.equal((await request('/health')).data.status,'ok');
 const bad=await fetch(base+'/api/v1/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:'null'});assert.equal(bad.status,400);
 for(let i=0;i<14;i++)await request('/api/v1/auth/login',account());assert.equal((await request('/api/v1/auth/login',account())).status,429);
 const page=await fetch(base+'/');assert.match(await page.text(),/Ну живи/);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
