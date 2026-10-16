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
 const waitFor=async expression=>{for(let i=0;i<300;i++){if(await evaluate(expression))return;await pause(50);}throw new Error('Timeout: '+expression);};
 await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await cdp('Page.navigate',{url:'http://localhost:3107'});
 await waitFor("!!document.querySelector('[data-do=register]')");await click('[data-do=register]');
 await evaluate(`document.querySelector('[name=name]').value='БраузерныйСосед';document.querySelector('[name=password]').value='browser-password-123';document.querySelector('#auth').requestSubmit()`);
 await waitFor("!!document.querySelector('.wallet')");await click('[data-do=tamara]');await click('[data-choice=hello]');await waitFor("!!document.querySelector('[data-choice=zero]')");await click('[data-choice=zero]');await waitFor("document.querySelector('.dialogue-line').textContent.includes('Миша')");await click('[data-do=close]');
 await click('[data-do=house]');await click('.floors button:not(:disabled)');await waitFor("document.querySelector('h1').textContent.includes('Мой уголок')");await click('[data-do=furniture]');await click('[data-do=buy-sofa]');await waitFor("!!document.querySelector('[data-position=right]')");await click('[data-position=right]');await waitFor("document.querySelector('.wallet').textContent.includes('2 500')");await click('[data-do=close]');
 await cdp('Page.reload');await waitFor("!!document.querySelector('.wallet')");assert.ok(await evaluate("document.querySelector('.wallet').textContent.includes('2 500')"));
 await click('[data-do=house]');await click('.floors button:not(:disabled)');assert.ok(await evaluate("document.querySelector('.furniture').textContent.includes('Переставить')"));
 const capture=async name=>{const shot=await cdp('Page.captureScreenshot',{format:'png'});writeFileSync('docs/'+name,Buffer.from(shot.data,'base64'));};
 await capture('preview-apartment.png');
 const story=[['misha','plumber'],['mailbox','mailbox'],['tamara','photo'],['tamara','listen'],['misha','address'],['shop','semyon'],['apartment','letter'],['mailbox','post'],['entrance','door'],['misha','repair'],['entrance','room'],['tamara','planArt'],['shop','invite'],['misha','lights'],['entrance','gather'],['tamara','promise']];
 for(const [npc,id] of story){
  await evaluate(`document.querySelector('.modal .close')?.click()`);
  // Public scene shortcuts include every location; desk is accessible in apartment.
  if(npc==='apartment')await click('[data-do=apartment]');
  else await click('.location-strip [data-do='+npc+']');
  await waitFor(`!!document.querySelector('[data-choice="${id}"]')`);await click('[data-choice="'+id+'"]');
  await waitFor(`!document.querySelector('[data-choice="${id}"]')`);
  if(id==='listen')await capture('preview-dialogue.png');
 }
 await click('.modal .close');
 await click('.sidebar [data-view=jobs]');await click('[data-job=delivery]');
 await waitFor("!!document.querySelector('.route-sheet strong')");
 const digits=await evaluate("document.querySelector('.route-sheet strong').textContent.split(' → ').map(Number)");
 for(const digit of digits)await click('[data-digit="'+digit+'"]');
 await waitFor("!document.querySelector('.finish-job').disabled");await click('.finish-job');
 await waitFor("!document.querySelector('.modal')");
 for(const [width,height] of [[1440,900],[390,844],[360,800]]){
  await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<700});await pause(100);
  assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),`Overflow at ${width}`);
  await click('.mobile-nav [data-view=district]').catch(()=>{});await click('.location-strip [data-do=tamara]');await waitFor("!!document.querySelector('.conversation')");assert.ok(await evaluate("document.querySelector('.modal').scrollWidth<=document.querySelector('.modal').clientWidth"),'Modal overflow');if(width===390)await capture('preview-mobile.png');await click('.modal .close');
  await click(width<700?'.mobile-nav [data-view=journal]':'.sidebar [data-view=journal]');await waitFor("document.querySelector('h1').textContent.includes('Истории')");assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'));
 }
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await click('.sidebar [data-view=district]');await pause(100);
 const screenshot=await cdp('Page.captureScreenshot',{format:'png'});writeFileSync('docs/preview-desktop.png',Buffer.from(screenshot.data,'base64'));
 assert.deepEqual(errors,[]);console.log('Browser PASS: signup → house → purchase → reload → complete 3 chapters → paid job; widths 1440 / 390 / 360; no JS exceptions.');
}finally{socket?.close();chrome.kill();app.kill();await pause(300);rmSync(temp,{recursive:true,force:true});}
