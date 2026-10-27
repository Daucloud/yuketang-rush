import { tileRects, courseURL, validateBatch, validateBatchAnswers } from './core.js';
import { recordMedia, recordGap } from './diagnostics.js';

let state, adviceCache={};
const adviceJobs=new Map();
const ready = Promise.all([chrome.storage.local.get('run'),chrome.storage.local.get('adviceCache')]).then(([{run},{adviceCache:cached}]) => {
  state = run || {paused:true, tasks:[], slots:[], config:{}};
  state.config={...state.config,autoQA:false,videosOnly:true};
  adviceCache=cached||{};
});
let chain = ready;
function serial(fn) { const p = chain.then(fn); chain = p.catch(() => {}); return p; }
async function save() { await chrome.storage.local.set({run:state}); }
const managed = id => state.slots.find(s => s.tabId === id);
const taskOf = slot => state.tasks.find(t => t.id === slot?.taskId);
function sleepState() { if (state.paused || !state.tasks.some(t => ['pending','opening','running','verifying'].includes(t.phase))) chrome.power.releaseKeepAwake(); else chrome.power.requestKeepAwake('display'); }
async function notifyTabs() {
  await Promise.allSettled(state.slots.map(async s => {
    await chrome.tabs.update(s.tabId,{muted:true});
    return chrome.tabs.sendMessage(s.tabId,{type:'REFRESH'});
  }));
}
async function layout(focus = false) {
  const displays = await chrome.system.display.getInfo();
  const display = displays.find(d => d.id === state.config.displayId) || displays.find(d => d.isPrimary) || displays[0];
  if (!display) throw Error('没有可用显示器');
  const rects = tileRects(display.workArea, state.slots.length);
  for (const [i,slot] of state.slots.entries()) {
    const w = await chrome.windows.get(slot.windowId);
    if (w.state !== 'normal') await chrome.windows.update(slot.windowId,{state:'normal'});
    await chrome.windows.update(slot.windowId,{...rects[i], ...(focus ? {focused:true} : {})});
    await chrome.tabs.update(slot.tabId,{active:true, autoDiscardable:false, muted:true});
  }
}
async function fillSlots() {
  if (state.paused) return;
  for (const slot of state.slots) {
    const current = taskOf(slot);
    if (current && !['done','skipped','manual'].includes(current.phase)) continue;
    const task = state.tasks.find(t => t.phase === 'pending');
    if (!task) { slot.taskId = null; continue; }
    slot.taskId = task.id; slot.lastSeen = Date.now(); slot.problemKey = null; slot.ownerFrame = null;
    task.phase = task.targetTitle ? 'opening' : 'running';
    task.note = '正在加载'; task.changedAt = Date.now();
    await save();
    try { await chrome.tabs.update(slot.tabId,{url:task.url,active:true,muted:true}); }
    catch { task.phase='attention'; task.note='课程窗口已关闭，请重新加入队列'; }
  }
  sleepState(); await save();
}
async function bridge(path, question, signal) {
  const {bridgeToken} = await chrome.storage.session.get('bridgeToken');
  if (!bridgeToken) throw Error('请先填写本地连接口令，并启动 npm start');
  const res = await fetch(`http://127.0.0.1:8765${path}`,{method:question?'POST':'GET',
    headers:{Authorization:`Bearer ${bridgeToken}`, 'Content-Type':'application/json'},
    ...(question ? {body:JSON.stringify(question)} : {}), signal:signal || AbortSignal.timeout(path==='/qa/batch'?150000:75000)});
  const body = await res.json();
  if (!res.ok) throw Error(body.error || `本地服务 HTTP ${res.status}`);
  return body;
}
function exerciseKey(sender) {
  const match=new URL(sender.url).pathname.match(/(?:iframe-exercise\/|lms-graph\/)(\d+)\/(?:exercise\/)?(\d+)/);
  if(!match || !/exercise/.test(new URL(sender.url).pathname)) throw Error('请在作业页面使用答案建议');
  return match[1]+':'+match[2];
}
const jobKey=sender=>`${sender.tab.id}:${sender.frameId}`;
async function advice(msg,sender) {
  await ready;
  const key=exerciseKey(sender),id=jobKey(sender);
  const questions=validateBatch(msg);
  const payload=JSON.stringify({questions});
  if(payload.length>32000000) throw Error('整份题目图片过大，请减少图片尺寸后重试');
  adviceJobs.get(id)?.abort();
  const controller=new AbortController();adviceJobs.set(id,controller);
  const timer=setTimeout(()=>controller.abort(),150000);
  try {
    const signature=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload)))).map(b=>b.toString(16).padStart(2,'0')).join('');
    if(controller.signal.aborted) throw Error('本次分析已取消');
    if(adviceCache[key]?.signature===signature) return {...adviceCache[key],cached:true};
    const result=validateBatchAnswers(await bridge('/qa/batch',{questions},controller.signal),questions);
    if(controller.signal.aborted || adviceJobs.get(id)!==controller) throw Error('本次分析已取消');
    const entry={...result,signature,at:Date.now()};
    adviceCache[key]=entry;
    for(const old of Object.keys(adviceCache).sort((a,b)=>adviceCache[b].at-adviceCache[a].at).slice(10)) delete adviceCache[old];
    await chrome.storage.local.set({adviceCache});
    return entry;
  } finally {clearTimeout(timer);if(adviceJobs.get(id)===controller)adviceJobs.delete(id);}
}
async function control(msg) {
  switch(msg.type) {
    case 'GET': return {...state, displays:await chrome.system.display.getInfo()};
    case 'TOKEN': await chrome.storage.session.set({bridgeToken:String(msg.token)}); return {ok:true};
    case 'START': {
      if (!state.paused && state.tasks.some(t => !['done','skipped','manual'].includes(t.phase))) throw Error('请先暂停当前队列');
      if (!Array.isArray(msg.tasks) || !msg.tasks.length || msg.tasks.length > 100) throw Error('请选择 1–100 个学习单元');
      const config = {count:Number(msg.config.count), rate:Number(msg.config.rate), displayId:msg.config.displayId, autoQA:false,videosOnly:true, focusWindows:msg.config.focusWindows === true};
      if (![1,1.25,1.5,2].includes(config.rate)) throw Error('请选择支持的倍速');
      const tasks = msg.tasks.filter(t=>t.kind!=='homework' && !/\/(?:iframe-)?exercise\//.test(t.url)).map(t => ({id:crypto.randomUUID(), url:courseURL(t.url), targetTitle:typeof t.targetTitle === 'string' ? t.targetTitle : '', title:String(t.title || t.targetTitle || t.url).slice(0,300), phase:'pending', note:''}));
      if(!tasks.length) throw Error('请选择视频单元；作业请在页面侧边查看答案建议');
      const ds = await chrome.system.display.getInfo();
      const d = ds.find(d => d.id === config.displayId) || ds.find(d => d.isPrimary);
      const count = Math.min(config.count,tasks.length);
      const rects = tileRects(d.workArea,count);
      // Stop previous workers before replacing their run identity.
      state.paused=true; await save(); await notifyTabs();
      state = {epoch:crypto.randomUUID(),paused:false,config,tasks,slots:[]};
      try {
        for (let i=0;i<count;i++) {
          const win = await chrome.windows.create({url:'about:blank',type:'normal',focused:config.focusWindows,...rects[i]});
          state.slots.push({windowId:win.id,tabId:win.tabs[0].id,taskId:null});
        }
        if(config.focusWindows) await layout(true);
        await fillSlots();
      } catch (err) { state.paused=true; sleepState(); await save(); throw err; }
      await chrome.alarms.create('watchdog',{periodInMinutes:.5});
      return {ok:true};
    }
    case 'PAUSE': state.paused=true; state.epoch=crypto.randomUUID(); sleepState(); await save(); await notifyTabs(); return {ok:true};
    case 'RESUME':
      if (!state.slots.length) throw Error('请先开始一个队列');
      if (typeof msg.focusWindows === 'boolean') state.config.focusWindows=msg.focusWindows;
      if(state.config.focusWindows === true) await layout(true);
      state.paused=false; state.epoch=crypto.randomUUID(); sleepState(); await fillSlots(); await notifyTabs(); return {ok:true};
    case 'TILE': await layout(true); return {ok:true};
    case 'RELOAD': {
      state.paused=true; state.epoch=crypto.randomUUID(); sleepState(); await save(); await notifyTabs();
      const results=await Promise.allSettled(state.slots.map(s=>chrome.tabs.reload(s.tabId)));
      results.forEach((result,i)=>{if(result.status==='rejected'){const t=taskOf(state.slots[i]);if(t){t.phase='attention';t.note='课程窗口无法刷新，请检查窗口是否已关闭';}}});
      await save();return {ok:true};
    }
    case 'RETRY': {
      const t=state.tasks.find(t => t.id === msg.id); if (!t) throw Error('任务不存在');
      const s=state.slots.find(s => s.taskId===t.id); if (!s) throw Error('任务未分配窗口');
      t.id=crypto.randomUUID(); s.taskId=t.id; t.submittedKeys=[];
      delete t.media; delete t.mediaSeenAt; delete t.mediaHistory; delete t.diagnostic;
      t.phase=t.targetTitle?'opening':'running'; t.note='重试中'; t.changedAt=Date.now(); s.problemKey=null; s.ownerFrame=null;
      await save(); await chrome.tabs.update(s.tabId,{url:t.url,active:true,muted:true}); return {ok:true};
    }
    case 'SKIP': {
      const t=state.tasks.find(t => t.id === msg.id); if (!t) throw Error('任务不存在');
      t.phase='skipped'; t.note='手动跳过'; await fillSlots(); await save(); await notifyTabs(); return {ok:true};
    }
    default: throw Error('未知操作');
  }
}
async function content(msg,sender) {
  if(msg.type==='ADVICE_COLLECT_START' || msg.type==='ADVICE_COLLECT_CANCEL') {
    if(sender.frameId!==0) throw Error('请从侧边面板操作');
    exerciseKey(sender);
    const response=await chrome.tabs.sendMessage(sender.tab.id,{type:msg.type==='ADVICE_COLLECT_START'?'COLLECT_ADVICE':'CANCEL_ADVICE',requestId:msg.requestId});
    if(msg.type==='ADVICE_COLLECT_START' && !response?.accepted)throw Error('题目页面尚未加载，请稍后再开始收集');
    return {ok:true};
  }
  if(msg.type==='ADVICE_PROGRESS') {
    await chrome.tabs.sendMessage(sender.tab.id,{type:'ADVICE_UI',exercise:exerciseKey(sender),requestId:msg.requestId,...msg.state});
    return {ok:true};
  }
  if(msg.type==='ADVICE_GET') return adviceCache[exerciseKey(sender)] || null;
  if(msg.type==='ADVICE_CANCEL') {adviceJobs.get(jobKey(sender))?.abort();return {ok:true};}
  if(msg.type==='ADVICE_CLEAR') {delete adviceCache[exerciseKey(sender)];await chrome.storage.local.set({adviceCache});return {ok:true};}
  if(msg.type==='CLAIM_SUBMIT' || msg.type==='ANSWER') throw Error('自动选择和提交已移除，请使用批量答案建议');
  const slot=managed(sender.tab?.id), task=taskOf(slot);
  if (!slot || !task) return {active:false};
  if (msg.type==='HELLO') {
    const {mediaHistory, ...workerTask}=task;
    return {active:!state.paused && ['opening','running','verifying'].includes(task.phase) && (slot.ownerFrame == null || task.phase !== 'running' || sender.frameId===slot.ownerFrame), task:workerTask, config:state.config, epoch:state.epoch};
  }
  if (state.paused || msg.epoch !== state.epoch || msg.taskId !== task.id) return {active:false};
  if (msg.type==='OPEN_UNIT') {
    if(task.phase!=='opening' || sender.frameId!==0) throw Error('当前任务不允许打开单元');
    const url=courseURL(msg.url);
    task.phase='running'; slot.ownerFrame=null; slot.lastSeen=Date.now();
    await save(); await chrome.tabs.update(slot.tabId,{url,active:true,muted:true});
    return {navigating:true};
  }
  if (msg.type==='STATUS') {
    if(task.phase==='running' && slot.ownerFrame != null && sender.frameId!==slot.ownerFrame) return {active:false};
    if(msg.media && task.phase==='running') slot.ownerFrame=sender.frameId;
    slot.lastSeen=Date.now(); task.note=String(msg.note||'').slice(0,300);
    if (msg.media) recordMedia(task,msg.media);
    if (msg.event==='opened' && task.phase==='opening') task.phase='running';
    if (msg.event==='attention') task.phase='attention';
    if (msg.event==='manual') {task.phase='manual';task.note='作业由你作答；页面侧边可批量查看答案建议';await fillSlots();}
    if (msg.event==='ended' && task.phase==='running') {
      if (task.targetTitle) { task.phase='verifying'; task.changedAt=Date.now(); slot.ownerFrame=null; await save(); await chrome.tabs.update(slot.tabId,{url:task.url}); }
      else { task.phase='attention'; task.note='视频已结束；独立链接无法回查目录，请核对后跳过或重试'; }
    }
    if (msg.event==='verified' && task.phase==='verifying') { task.phase='done'; task.note='课程目录显示已完成'; await fillSlots(); }
    sleepState(); await save(); return {ok:true};
  }
  throw Error('未知页面消息');
}
chrome.runtime.onMessage.addListener((msg,sender,sendResponse) => {
  const internal = sender.url?.startsWith(chrome.runtime.getURL(''));
  const fromCourse = sender.tab && sender.url?.startsWith('https://pro.yuketang.cn/');
  let p;
  if (internal && msg.type==='HEALTH') p=ready.then(()=>bridge('/health'));
  else if (internal) p=serial(()=>control(msg));
  else if (fromCourse && msg.type==='ADVICE_BATCH') p=advice(msg,sender);
  else if (fromCourse) p=serial(()=>content(msg,sender));
  else p=Promise.reject(Error('不接受此来源的消息'));
  p.then(value=>sendResponse({ok:true,value})).catch(e=>sendResponse({ok:false,error:e.message})); return true;
});
// Some course cards use window.open. Adopt only children of our own opening workers.
async function adopt(tab) {
  const slot=managed(tab.openerTabId), task=taskOf(slot);
  if (!slot || task?.phase!=='opening' || state.paused || !String(tab.url||tab.pendingUrl).startsWith('https://pro.yuketang.cn/')) return;
  const oldId=slot.tabId;
  await chrome.tabs.move(tab.id,{windowId:slot.windowId,index:0});
  slot.tabId=tab.id; task.phase='running'; slot.lastSeen=Date.now(); await save();
  await chrome.tabs.update(tab.id,{active:true,autoDiscardable:false,muted:true});
  await chrome.tabs.remove(oldId);
}
chrome.tabs.onCreated.addListener(tab=>{ serial(()=>adopt(tab)).catch(()=>{}); });
chrome.tabs.onUpdated.addListener((id,change,tab)=>{ if(change.url) serial(()=>adopt(tab)).catch(()=>{}); });
chrome.tabs.onRemoved.addListener(id=>{ serial(async()=>{
  const slot=managed(id), task=taskOf(slot);
  if(task) { task.phase='attention'; task.note='窗口已被关闭，请重新开始队列'; sleepState(); await save(); }
}).catch(()=>{}); });
chrome.alarms.onAlarm.addListener(alarm=>{ if(alarm.name==='watchdog') serial(async()=>{
  if(state.paused) return;
  for(const slot of state.slots) {
    const task=taskOf(slot); if(!task || !['opening','running','verifying'].includes(task.phase)) continue;
    if(Date.now()-(slot.lastSeen||0)>60000) { task.note='超过 60 秒未收到页面状态，请检查登录、标签页或遮挡'; recordGap(task); }
  }
  sleepState(); await save();
}).catch(()=>{}); });
chrome.runtime.onStartup.addListener(()=>{ serial(async()=>{state.paused=true; state.epoch=crypto.randomUUID(); sleepState(); await save();}).catch(()=>{}); });
