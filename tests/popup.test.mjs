import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {courseURL} from '../extension/core.js';
import {diagnosticNames} from '../extension/diagnostics.js';
import {validateModelSettings,modelOrigin,defaultModelSettings} from '../extension/model.js';
const html=await readFile(new URL('../extension/popup.html',import.meta.url),'utf8');
const source=(await readFile(new URL('../extension/popup.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
async function fixture(t,allow=true,options={}) {
  const dom=new JSDOM(html,{url:options.url||'https://extension.example/popup.html',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window,events=[],bag=structuredClone(options.saved||{}),tabs=structuredClone(options.tabs||[{id:1,url:'https://pro.yuketang.cn/v2/web/studentLog/10001',title:'示例课程'}]);let scanResponse=options.scan||((id)=>({ok:true,value:[{url:tabs.find(t=>t.id===id).url,title:'视频-'+id,targetTitle:'视频-'+id,kind:'video',completed:false}]}));let config={...defaultModelSettings,hasApiKey:false},testResponse=async()=>({ok:true,value:{model:config.model,vision:true}});
  Object.assign(w,{localGet:async key=>structuredClone({[key]:bag[key]}),localSet:async values=>Object.assign(bag,structuredClone(values)),localRemove:async()=>{},courseURL,diagnosticNames,validateModelSettings,modelOrigin,defaultModelSettings});w.setInterval=()=>0;
  w.chrome={tabs:{query:async q=>structuredClone(q.url?tabs:[tabs.find(t=>t.id===(options.activeId??tabs[0]?.id))||{id:999,url:'https://extension.example/popup.html'}]),get:async id=>{const tab=tabs.find(t=>t.id===id);if(!tab)throw Error('closed');return structuredClone(tab);},sendMessage:async(id,msg)=>{events.push({type:msg.type,tabId:id});return scanResponse(id);}},permissions:{request:async p=>{events.push(structuredClone({type:'PERMISSION',...p}));return allow;}},storage:{local:{get:async()=>({})}},runtime:{sendMessage:async msg=>{
    events.push(structuredClone(msg));
    if(msg.type==='MODEL_TEST')return testResponse();
    if(msg.type==='MODEL_GET')return {ok:true,value:config};
    if(msg.type==='MODEL_SAVE'){config={baseURL:msg.settings.baseURL,model:msg.settings.model,hasApiKey:true};return {ok:true,value:config};}
    if(msg.type==='MODEL_CLEAR'){config={...defaultModelSettings,hasApiKey:false};return {ok:true,value:{}};}
    if(msg.type==='GET')return {ok:true,value:{tasks:[],paused:true,config:{},displays:[]}};
    return {ok:true,value:{model:config.model,vision:true}};
  }}};
  await w.eval('(async()=>{'+source+'})()');
  const click=async id=>{await w.document.getElementById(id).onclick();};
  return {w,events,click,tabs,bag,scanResponse:fn=>{scanResponse=fn;},testResponse:fn=>{testResponse=fn;},field:id=>w.document.getElementById(id)};
}
test('saving model settings requests only its API site and clears the visible key field',async t=>{
  const f=await fixture(t);f.field('baseURL').value='https://model.example/v1';f.field('model').value='vision-model';f.field('apiKey').value='test-key';
  await f.click('saveModel');
  const relevant=f.events.filter(m=>m.type==='PERMISSION'||m.type==='MODEL_SAVE');assert.deepEqual(relevant.map(m=>m.type),['PERMISSION','MODEL_SAVE']);
  assert.deepEqual(relevant[0].origins,['https://model.example/*']);assert.equal(f.field('apiKey').value,'');assert.match(f.field('modelState').textContent,/已配置/);
  await f.click('testModel');assert.match(f.field('modelMessage').textContent,/图片输入测试通过/);
});
test('denied API site permission does not save or test credentials',async t=>{
  const f=await fixture(t,false);f.field('apiKey').value='test-key';await f.click('saveModel');
  assert.ok(!f.events.some(m=>m.type==='MODEL_SAVE'));assert.match(f.field('modelMessage').textContent,/未授予/);
});
test('video start is independent of model configuration and deleting credentials resets model UI',async t=>{
  const f=await fixture(t);f.field('urls').value='https://pro.yuketang.cn/ai-workspace/lms-graph/10001/video/30001';await f.click('add');await f.click('start');
  assert.ok(f.events.some(m=>m.type==='START'));assert.ok(!f.events.some(m=>['MODEL_SAVE','MODEL_TEST','TOKEN','HEALTH'].includes(m.type)));
  await f.click('clearModel');assert.equal(f.field('apiKey').value,'');assert.match(f.field('modelState').textContent,/未配置/);
  f.field('model').value='edited-model';await f.click('testModel');assert.match(f.field('modelMessage').textContent,/先保存/);
});

test('connection tests show progress immediately and report errors beside the button',async t=>{
  const f=await fixture(t);f.field('apiKey').value='test-key';await f.click('saveModel');
  let finish;f.testResponse(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=f.click('testModel');assert.equal(f.field('testModel').disabled,true);assert.match(f.field('testModel').textContent,/正在测试/);assert.match(f.field('modelMessage').textContent,/最多等待 30 秒/);
  finish({ok:false,error:'模型接口返回 HTTP 401'});await pending;
  assert.match(f.field('modelMessage').textContent,/HTTP 401/);assert.equal(f.field('modelMessage').classList.contains('error'),true);assert.equal(f.field('testModel').disabled,false);assert.equal(f.field('testModel').textContent,'测试连接与图片输入');
});

const oldURL='https://pro.yuketang.cn/v2/web/studentLog/10001',newURL='https://pro.yuketang.cn/v2/web/studentLog/10002';
const courseTabs=[{id:1,url:oldURL,title:'历史课程'},{id:2,url:newURL,title:'新课程'}];
const oldCandidates={candidates:[{url:oldURL,title:'旧视频',targetTitle:'旧视频',kind:'video',selected:true}],candidateSource:{mode:'directory',tabId:1,url:oldURL,title:'历史课程'}};
test('dashboard can switch away from its original course tab and scan replaces the previous list',async t=>{
 const f=await fixture(t,true,{tabs:courseTabs,saved:oldCandidates,activeId:999,url:'https://extension.example/popup.html?dashboard=1&sourceTab=1'});
 assert.equal(f.field('courseTab').value,'1');f.field('courseTab').value='2';await f.field('courseTab').onchange();await f.click('scan');
 assert.deepEqual(f.bag.candidates.map(c=>c.title),['视频-2']);assert.equal(f.bag.candidateSource.tabId,2);assert.equal(f.bag.candidateSource.url,newURL);
 await f.click('start');const start=f.events.find(m=>m.type==='START');assert.deepEqual(start.tasks.map(t=>t.url),[newURL]);assert.equal(start.source.title,'新课程');
});
test('opening the popup from another active course does not restore the original dashboard tab or old selections',async t=>{
 const f=await fixture(t,true,{tabs:courseTabs,saved:oldCandidates,activeId:2,url:'https://extension.example/popup.html?sourceTab=1'});
 assert.equal(f.field('courseTab').value,'2');assert.equal(f.field('candidates').children.length,0);await f.click('start');assert.ok(!f.events.some(m=>m.type==='START'));
 await f.click('scan');assert.equal(f.bag.candidates[0].url,newURL);
});
test('legacy candidates and navigation to another course cannot silently start an old queue',async t=>{
 const legacy=await fixture(t,true,{saved:{candidates:oldCandidates.candidates}});assert.equal(legacy.field('candidates').children.length,0);await legacy.click('start');assert.ok(!legacy.events.some(m=>m.type==='START'));
 const f=await fixture(t,true,{tabs:[courseTabs[0]],saved:oldCandidates});f.tabs[0].url=newURL;await f.click('start');
 assert.ok(!f.events.some(m=>m.type==='START'));assert.match(f.field('message').textContent,/课程页面已变化/);
});
test('a scan racing with course navigation cannot replace the list with stale results',async t=>{
 const f=await fixture(t,true,{tabs:[courseTabs[0]]});f.scanResponse(()=>{f.tabs[0].url=newURL;return {ok:true,value:oldCandidates.candidates};});
 await f.click('scan');assert.match(f.field('message').textContent,/课程页面发生变化/);assert.equal(f.field('candidates').children.length,0);
});

test('a scan may select learning content only within the original course',async t=>{
 const f=await fixture(t,true,{tabs:[courseTabs[0]]});f.scanResponse(()=>{f.tabs[0].url=oldURL+'?tab=content';return {ok:true,value:[{url:f.tabs[0].url,title:'示例视频',targetTitle:'示例视频',kind:'video'}]};});
 await f.click('scan');assert.equal(f.bag.candidateSource.url,oldURL+'?tab=content');await f.click('start');assert.ok(f.events.some(m=>m.type==='START'));
 const other=await fixture(t,true,{tabs:[courseTabs[0]]});other.scanResponse(()=>{other.tabs[0].url=newURL+'?tab=content';return {ok:true,value:[{url:other.tabs[0].url,title:'其他课程',kind:'video'}]};});
 await other.click('scan');assert.match(other.field('message').textContent,/课程页面发生变化/);assert.equal(other.field('candidates').children.length,0);
});
