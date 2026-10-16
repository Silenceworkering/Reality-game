import { cpSync, mkdirSync, rmSync } from 'node:fs';
rmSync('dist',{recursive:true,force:true});mkdirSync('dist',{recursive:true});
for(const path of ['apps','packages','package.json'])cpSync(path,'dist/'+path,{recursive:true});
console.log('Built dist/ — node dist/apps/server/server.mjs');
