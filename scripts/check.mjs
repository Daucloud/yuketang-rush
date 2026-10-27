import {readdir,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const files=['server.mjs','ocr.mjs',...(await readdir('extension')).filter(f=>f.endsWith('.js')).map(f=>`extension/${f}`)];
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);}
const manifest=JSON.parse(await readFile('extension/manifest.json','utf8'));
for(const file of [manifest.background.service_worker,manifest.action.default_popup,...manifest.content_scripts.flatMap(s=>s.js)])await readFile(`extension/${file}`);
console.log(`Syntax and extension entry points OK (${files.length} JavaScript files)`);

for(const [size,file] of Object.entries(manifest.icons||{})) {
  const data=await readFile(`extension/${file}`);
  if(!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || data.readUInt32BE(16)!==Number(size) || data.readUInt32BE(20)!==Number(size))throw Error('Invalid extension icon: '+file);
}
console.log('Manifest icons OK');
