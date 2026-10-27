import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {localGet} from '../extension/storage.js';
const ext='chrome-extension://abcdefghijklmnopabcdefghijklmnop/';
const home='https://pro.yuketang.cn/v2/web/studentLog/10001';
function event(){return {listeners:[],addListener(fn){this.listeners.push(fn);}};}
async function fixture(t){
  const originalChrome=globalThis.chrome,originalIDB=globalThis.indexedDB;globalThis.indexedDB=indexedDB;
  const data={},session={},permissions=new Set(),windows=new Map(),tabs=new Map(),windowUpdates=[];let counter=10;
  const store=bag=>({get:async key=>structuredClone({[key]:bag[key]}),set:async obj=>Object.assign(bag,structuredClone(obj)),remove:async key=>{delete bag[key];},setAccessLevel:async opts=>{bag.accessLevel=opts.accessLevel;}});
  const chrome={
    storage:{local:store(data),session:store(session)},
    permissions:{contains:async ({origins})=>origins.every(o=>permissions.has(o))},
    runtime:{getURL:p=>ext+p,onMessage:event(),onStartup:event()},
    system:{display:{getInfo:async()=>[{id:'main',isPrimary:true,workArea:{left:0,top:25,width:1512,height:835}}]}},
    power:{requestKeepAwake(){},releaseKeepAwake(){}},
    alarms:{create:async()=>{},onAlarm:event()},
    windows:{create:async opts=>{const id=counter++,tab={id:counter++,windowId:id,url:opts.url};tabs.set(tab.id,tab);const w={...opts,id,state:'normal',tabs:[tab]};windows.set(id,w);return structuredClone(w);},get:async id=>structuredClone(windows.get(id)),update:async(id,opts)=>{windowUpdates.push({id,opts});return Object.assign(windows.get(id),opts);}},
    tabs:{onCreated:event(),onUpdated:event(),onRemoved:event(),sendMessage:async()=>({ok:true}),reload:async id=>{if(!tabs.has(id))throw Error('tab closed');tabs.get(id).reloaded=true;},update:async(id,opts)=>{if(!tabs.has(id))throw Error('tab closed');Object.assign(tabs.get(id),opts);return structuredClone(tabs.get(id));},move:async(id,opts)=>{if(!tabs.has(id))tabs.set(id,{id});Object.assign(tabs.get(id),opts);},remove:async id=>{tabs.delete(id);for(const f of chrome.tabs.onRemoved.listeners)f(id);}}
  };
  globalThis.chrome=chrome;t.after(()=>{globalThis.chrome=originalChrome;globalThis.indexedDB=originalIDB;});
  await import(`../extension/background.js?test=${crypto.randomUUID()}`);
  const send=(msg,sender={url:ext+'popup.html'})=>new Promise(resolve=>chrome.runtime.onMessage.listeners[0](structuredClone(msg),sender,response=>resolve(structuredClone(response))));
  const get=async()=>{const r=await send({type:'GET'});assert.equal(r.ok,true);return r.value;};
  await get();
  const start=async(count=2)=>send({type:'START',tasks:Array.from({length:3},(_,i)=>({url:home,targetTitle:`video-${i}`})),config:{count,rate:2,autoQA:true}});
  const page=(slot,frameId=0)=>({tab:{id:slot.tabId},url:home,frameId});
  const configure=async()=>{permissions.add('https://model.example/*');return send({type:'MODEL_SAVE',settings:{baseURL:'https://model.example/v1',model:'vision-model',apiKey:'test-api-key'}});};
  return {chrome,send,get,start,page,tabs,windows,windowUpdates,data,permissions,configure};
}
test('start and resume keep windows unfocused by default; explicit tile brings them forward',async t=>{
  const f=await fixture(t);await f.start();
  assert.ok([...f.windows.values()].every(w=>w.focused===false));
  assert.ok([...f.tabs.values()].every(tab=>tab.muted===true));
  await f.send({type:'PAUSE'});await f.send({type:'RESUME'});
  assert.ok([...f.windows.values()].every(w=>w.focused===false));
  assert.equal(f.windowUpdates.length,0,'background start/resume must not reposition or restore windows');
  await f.send({type:'TILE'});assert.ok([...f.windows.values()].every(w=>w.focused===true));
});
test('directory popup capture navigates the same muted tab without opening or focusing a window',async t=>{
  const f=await fixture(t);await f.start();let s=await f.get(),slot=s.slots[0];
  const base={type:'OPEN_UNIT',epoch:s.epoch,taskId:slot.taskId};
  assert.equal((await f.send({...base,url:'https://evil.example/'},f.page(slot))).ok,false);
  assert.equal((await f.send({...base,url:home},f.page(slot,2))).ok,false);
  const url='https://pro.yuketang.cn/ai-workspace/lms-graph/10001/video/30001';
  assert.equal((await f.send({...base,url},f.page(slot))).value.navigating,true);
  assert.equal(f.tabs.get(slot.tabId).url,url);assert.equal(f.tabs.get(slot.tabId).muted,true);
  assert.equal(f.windows.size,2);assert.ok([...f.windows.values()].every(w=>w.focused===false));
  assert.equal((await f.get()).tasks[0].phase,'running');
  assert.equal((await f.send({...base,url},f.page(slot))).ok,false);
});
test('worker reload preserves tasks, pauses the queue, invalidates old messages and never focuses windows',async t=>{
  const f=await fixture(t);await f.start();const before=await f.get();
  await f.send({type:'RELOAD'});const after=await f.get();
  assert.equal(after.paused,true);assert.notEqual(after.epoch,before.epoch);
  assert.deepEqual(after.tasks,before.tasks);assert.ok([...f.tabs.values()].every(tab=>tab.reloaded&&tab.muted));
  assert.equal(f.windowUpdates.length,0);
});
test('playback diagnostics reject other frames and old epochs, and survive controller reads',async t=>{
  const f=await fixture(t);await f.start();let s=await f.get(),slot=s.slots[0];
  const base={type:'STATUS',epoch:s.epoch,taskId:slot.taskId};
  await f.send({...base,event:'opened'},f.page(slot));
  const media={time:10,rate:2,visible:true,focused:false,paused:false};
  await f.send({...base,media},f.page(slot,2));
  await f.send({...base,media:{...media,time:999}},f.page(slot,0));
  await f.send({...base,epoch:'stale',media:{...media,time:999}},f.page(slot,2));
  s=await f.get();assert.equal(s.tasks[0].media.time,10);assert.equal(s.tasks[0].diagnostic,'unfocused');
  assert.equal(s.tasks[0].mediaHistory.length,1);
  const hello=await f.send({type:'HELLO'},f.page(slot,2));assert.ok(!('mediaHistory' in hello.value.task));
});
test('queue waits for directory completion and ignores stale completion messages',async t=>{
  const f=await fixture(t);assert.equal((await f.start()).ok,true);
  let s=await f.get();assert.equal(s.slots.length,2);assert.equal(s.tasks[2].phase,'pending');
  const slot=s.slots[0],oldId=slot.taskId;
  const report=event=>f.send({type:'STATUS',event,note:event,epoch:s.epoch,taskId:oldId},f.page(slot));
  await report('opened');await report('ended');s=await f.get();assert.equal(s.tasks[0].phase,'verifying');assert.equal(s.tasks[2].phase,'pending');
  await report('verified');s=await f.get();assert.equal(s.tasks[0].phase,'done');assert.equal(s.tasks[2].phase,'opening');
  await report('verified');s=await f.get();assert.equal(s.tasks[2].phase,'opening');
});
test('full dashboard tab can control the queue but ordinary website tabs cannot',async t=>{
  const f=await fixture(t);
  assert.equal((await f.send({type:'GET'},{url:ext+'popup.html',tab:{id:300}})).ok,true);
  assert.equal((await f.send({type:'START'},{url:'https://evil.example/',tab:{id:301}})).ok,false);
});
test('only a managed opener can transfer a new course tab into its slot',async t=>{
  const f=await fixture(t);await f.start();let s=await f.get();const slot=s.slots[0];
  for(const fn of f.chrome.tabs.onCreated.listeners)fn({id:90,openerTabId:999,url:home});
  await f.get();assert.equal(f.tabs.has(90),false);
  for(const fn of f.chrome.tabs.onCreated.listeners)fn({id:91,openerTabId:slot.tabId,url:'https://pro.yuketang.cn/ai-workspace/lms-graph/10001/video/30002'});
  s=await f.get();assert.equal(s.slots[0].tabId,91);assert.equal(f.tabs.has(slot.tabId),false);assert.equal(s.tasks[0].phase,'running');
});
test('legacy automatic answers and submission claims are rejected',async t=>{
  const f=await fixture(t);await f.start();const s=await f.get(),slot=s.slots[0];
  assert.equal(s.config.autoQA,false);assert.equal(s.config.videosOnly,true);
  assert.equal((await f.send({type:'CLAIM_SUBMIT',epoch:s.epoch,taskId:slot.taskId,key:'q'},f.page(slot))).ok,false);
  assert.equal((await f.send({type:'ANSWER',question:{}},f.page(slot))).ok,false);
});
test('video queue filters homework and moves past an unclassified homework task',async t=>{
  const f=await fixture(t);
  const start=await f.send({type:'START',tasks:[{url:home,targetTitle:'作业',kind:'homework'},{url:home,targetTitle:'视频',kind:'video'},{url:home,targetTitle:'视频2',kind:'video'}],config:{count:1,rate:2,autoQA:true}});
  assert.equal(start.ok,true);let s=await f.get();assert.equal(s.tasks.length,2);
  const slot=s.slots[0];await f.send({type:'STATUS',event:'manual',epoch:s.epoch,taskId:slot.taskId},f.page(slot));
  s=await f.get();assert.equal(s.tasks[0].phase,'manual');assert.equal(s.tasks[1].phase,'opening');
});
test('batch advice works independently of the paused video queue and is cached without images',async t=>{
  const f=await fixture(t);assert.equal((await f.configure()).ok,true);
  const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async(target,opts)=>{calls++;assert.equal(String(target),'https://model.example/v1/chat/completions');assert.equal(opts.headers.Authorization,'Bearer test-api-key');const questions=JSON.parse(opts.body).messages[1].content.map(p=>JSON.parse(p.text));return Response.json({choices:[{message:{content:JSON.stringify({answers:questions.map(q=>({...q,selected:['B'],uncertain:false,explanation:'根据题目'}))})}}]});};
  t.after(()=>{globalThis.fetch=originalFetch;});
  const sender={tab:{id:600},url:'https://pro.yuketang.cn/v2/web/iframe-exercise/10001/20001',frameId:2};
  const msg={type:'ADVICE_BATCH',questions:[{id:'1',kind:'single',stem:'Test?',options:[{id:'A',text:'One'},{id:'B',text:'Two'}]}]};
  const first=await f.send(msg,sender),second=await f.send(msg,sender);
  assert.equal(first.ok,true);assert.equal(second.value.cached,true);assert.equal(calls,1);assert.equal((await f.get()).paused,true);
  const cache=await f.send({type:'ADVICE_GET'},sender);assert.equal(cache.value.answers[0].id,'1');assert.ok(!JSON.stringify(cache).includes('rendered'));
});
test('cancel discards a pending batch even if the provider eventually returns',async t=>{
  const f=await fixture(t);assert.equal((await f.configure()).ok,true);
  const originalFetch=globalThis.fetch;let resolve;globalThis.fetch=async()=>new Promise(r=>{resolve=r;});t.after(()=>{globalThis.fetch=originalFetch;});
  const sender={tab:{id:600},url:'https://pro.yuketang.cn/v2/web/iframe-exercise/10001/20001',frameId:2};
  const q={id:'1',kind:'single',stem:'Test?',options:[{id:'A',text:'One'},{id:'B',text:'Two'}]};
  const result=f.send({type:'ADVICE_BATCH',questions:[q]},sender);
  while(!resolve)await new Promise(r=>setImmediate(r));
  assert.equal((await f.send({type:'ADVICE_CANCEL'},sender)).ok,true);
  resolve(Response.json({choices:[{message:{content:JSON.stringify({answers:[{...q,selected:['A'],uncertain:false,explanation:'test'}]})}}]}));
  assert.equal((await result).ok,false);assert.equal((await f.send({type:'ADVICE_GET'},sender)).value,null);
});

test('model settings stay in trusted local storage and never appear in course messages or diagnostics',async t=>{
  const f=await fixture(t);assert.equal(f.data.accessLevel,'TRUSTED_CONTEXTS');
  assert.equal((await f.configure()).ok,true);
  const view=await f.send({type:'MODEL_GET'});assert.equal(view.value.hasApiKey,true);assert.ok(!JSON.stringify(view).includes('test-api-key'));
  assert.ok(!JSON.stringify(await f.get()).includes('test-api-key'));
  const sender={tab:{id:600},url:'https://pro.yuketang.cn/v2/web/iframe-exercise/10001/20001',frameId:0};
  assert.ok(!JSON.stringify(await f.send({type:'MODEL_GET'},sender)).includes('test-api-key'));
  await f.send({type:'MODEL_CLEAR'});assert.equal(f.data.modelConfig,undefined);assert.equal((await f.send({type:'MODEL_GET'})).value.hasApiKey,false);
});
test('saving requires site permission and never reuses the saved key for a different API origin',async t=>{
  const f=await fixture(t);
  const settings={baseURL:'https://model.example/v1',model:'vision-model',apiKey:'test-api-key'};
  assert.equal((await f.send({type:'MODEL_SAVE',settings})).ok,false);assert.equal(f.data.modelConfig,undefined);
  await f.configure();
  assert.equal((await f.send({type:'MODEL_SAVE',settings:{...settings,model:'new-model',apiKey:''}})).ok,true);
  assert.equal((await localGet('modelConfig')).modelConfig.apiKey,'test-api-key');assert.ok(!JSON.stringify(f.data.modelConfig).includes('test-api-key'));
  f.permissions.add('https://other.example/*');
  assert.equal((await f.send({type:'MODEL_SAVE',settings:{...settings,baseURL:'https://other.example/v1',apiKey:''}})).ok,false);
  assert.equal((await localGet('modelConfig')).modelConfig.baseURL,'https://model.example/v1');
});
