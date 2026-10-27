import {execFileSync} from 'node:child_process';
import {readFile, mkdir} from 'node:fs/promises';
const {version}=JSON.parse(await readFile(new URL('../package.json',import.meta.url)));
const tracked=execFileSync('git',['ls-files'],{encoding:'utf8'}).trim().split('\n');
if(tracked.some(path=>/^\.env(?:\.|$)/.test(path)&&path!=='.env.example'||/^(?:diagnostics|\.tools|\.chrome-profile|node_modules)\//.test(path)||/^(?:HANDOFF|E2E_REPORT|OPEN_SOURCE_RESEARCH)\.md$/.test(path)))throw Error('待发布内容包含本地记录或敏感配置，请先移除');
await mkdir(new URL('../dist/',import.meta.url),{recursive:true});
for(const [name,prefix,ref] of [[`yuketang-extension-${version}.zip`,'extension/','HEAD:extension'],[`yuketang-rush-${version}.zip`,`yuketang-rush-${version}/`,'HEAD']]) {
  execFileSync('git',['archive','--format=zip',`--prefix=${prefix}`,`--output=dist/${name}`,ref]);
  console.log(`dist/${name}`);
}
