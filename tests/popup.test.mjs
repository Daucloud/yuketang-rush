import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {courseURL} from '../extension/core.js';
import {diagnosticNames} from '../extension/diagnostics.js';
import {validateModelSettings,modelOrigin,defaultModelSettings} from '../extension/model.js';
const html=await readFile(new URL('../extension/popup.html',import.meta.url),'utf8');
const source=(await readFile(new URL('../extension/popup.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
async function fixture(t,allow=true) {
  const dom=new JSDOM(html,{url:'https://extension.example/popup.html',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window,events=[];let config={...defaultModelSettings,hasApiKey:false},testResponse=async()=>({ok:true,value:{model:config.model,vision:true}});
  Object.assign(w,{localGet:async()=>({}),localSet:async()=>{},localRemove:async()=>{},courseURL,diagnosticNames,validateModelSettings,modelOrigin,defaultModelSettings});w.setInterval=()=>0;
  w.chrome={permissions:{request:async p=>{events.push(structuredClone({type:'PERMISSION',...p}));return allow;}},storage:{local:{get:async()=>({})}},runtime:{sendMessage:async msg=>{
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
  return {w,events,click,testResponse:fn=>{testResponse=fn;},field:id=>w.document.getElementById(id)};
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
  const f=await fixture(t);await f.click('start');
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
