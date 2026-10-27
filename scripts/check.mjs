import {readdir,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const files=['server.mjs','ocr.mjs',...(await readdir('extension')).filter(f=>f.endsWith('.js')).map(f=>`extension/${f}`)];
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);}
const manifest=JSON.parse(await readFile('extension/manifest.json','utf8'));
for(const file of [manifest.background.service_worker,manifest.action.default_popup,...manifest.content_scripts.flatMap(s=>s.js)])await readFile(`extension/${file}`);
console.log(`Syntax and extension entry points OK (${files.length} JavaScript files)`);
