import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const temp=mkdtempSync(join(tmpdir(),'nu-zhivi-browser-'));
const app=spawn(process.execPath,['apps/server/server.mjs'],{env:{...process.env,PORT:'3107',DATABASE_PATH:join(temp,'game.sqlite')},stdio:'ignore'});
const chrome=spawn(process.env.CHROMIUM || '/usr/bin/chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=9227','--user-data-dir='+temp+'/chrome','about:blank'],{stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let socket;
try{
 let page;
 for(let i=0;i<100;i++){try{await fetch('http://localhost:3107/health');const pages=await (await fetch('http://localhost:9227/json')).json();page=pages.find(p=>p.type==='page');if(page)break;}catch{}await pause(100);}
 if(!page)throw new Error('Browser unavailable');
 socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));let sequence=0;const pending=new Map();const errors=[];
 socket.addEventListener('message',e=>{const message=JSON.parse(e.data);if(message.id){const {resolve,reject}=pending.get(message.id);pending.delete(message.id);message.error?reject(new Error(JSON.stringify(message.error))):resolve(message.result);}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);});
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
 const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const waitFor=async expression=>{for(let i=0;i<80;i++){if(await evaluate(expression))return;await pause(50);}throw new Error('Timeout: '+expression);};
 await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await cdp('Page.navigate',{url:'http://localhost:3107'});
 await waitFor("!!document.querySelector('[data-do=register]')");await click('[data-do=register]');
 await evaluate(`document.querySelector('[name=name]').value='БраузерныйСосед';document.querySelector('[name=password]').value='browser-password-123';document.querySelector('#auth').requestSubmit()`);
 await waitFor("!!document.querySelector('.wallet')");await click('[data-do=tamara]');await click('[data-choice=hello]');await waitFor("!!document.querySelector('[data-choice=zero]')");await click('[data-choice=zero]');await waitFor("document.querySelector('.dialogue-line').textContent.includes('почтовом')");await click('[data-do=close]');
 await click('[data-do=house]');await click('[data-apartment="1"]');await waitFor("document.querySelector('h1').textContent.includes('Мой уголок')");await click('[data-do=furniture]');await click('[data-do=buy-sofa]');await waitFor("!!document.querySelector('[data-position=right]')");await click('[data-position=right]');await waitFor("document.querySelector('.wallet').textContent.includes('2 500')");await click('[data-do=close]');
 await cdp('Page.reload');await waitFor("!!document.querySelector('.wallet')");assert.ok(await evaluate("document.querySelector('.wallet').textContent.includes('2 500')"));
 await click('[data-do=house]');await click('[data-apartment="1"]');assert.ok(await evaluate("document.querySelector('.furniture').textContent.includes('Переставить')"));
 for(const [width,height] of [[1440,900],[390,844],[360,800]]){
  await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<700});await pause(100);
  assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),`Overflow at ${width}`);
  await click('[data-do=tamara]').catch(()=>{});
  await click(width<700?'.mobile-nav [data-view=journal]':'.sidebar [data-view=journal]');await waitFor("document.querySelector('h1').textContent.includes('Истории')");assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'));
 }
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await click('.sidebar [data-view=district]');await pause(100);
 const screenshot=await cdp('Page.captureScreenshot',{format:'png'});writeFileSync('docs/preview-desktop.png',Buffer.from(screenshot.data,'base64'));
 assert.deepEqual(errors,[]);console.log('Browser PASS: signup → dialogues → house → purchase → move → reload; widths 1440 / 390 / 360; no JS exceptions.');
}finally{socket?.close();chrome.kill();app.kill();await pause(300);rmSync(temp,{recursive:true,force:true});}
