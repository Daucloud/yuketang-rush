import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const source=await readFile(new URL('../extension/content.js',import.meta.url),'utf8');
const home='https://pro.yuketang.cn/v2/web/studentLog/1';
const row='<article><div><h2>课程一</h2><span>考核截止时间：2027-01-08</span></div><span>未开始</span></article>';
const quiz='<section><div><div class="problem-body">问题一</div><label class="el-radio"><input type="radio" name="answer" value="A"><span class="radioText">甲</span></label><label class="el-radio"><input type="radio" name="answer" value="B"><span class="radioText">乙</span></label></div><button>提交</button></section>';
async function flush(predicate=()=>true){for(let i=0;i<100;i++){await new Promise(r=>setImmediate(r));if(predicate())return;}throw Error('fixture did not settle');}
async function fixture(t,html,url=home){
  const dom=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true});t.after(()=>dom.window.close());
  const w=dom.window;let tick,listener;const messages=[];
  let state={active:false,task:{id:'task-1',url:home,title:'课程一',targetTitle:'课程一',phase:'running'},epoch:'epoch',config:{rate:2,autoQA:true}};
  let answer=async()=>({selected:['B'],uncertain:false,explanation:'测试'});
  w.HTMLElement.prototype.getClientRects=function(){for(let el=this;el;el=el.parentElement)if(el.style.display==='none' || el.hidden)return [];return [{left:0,top:0,width:100,height:30}];};
  w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.setInterval=fn=>{tick=fn;};w.setTimeout=fn=>setImmediate(fn);
  w.postMessage=msg=>{if(msg.type==='YKT_ARM_OPEN')w.dispatchEvent(new w.MessageEvent('message',{data:{type:'YKT_OPEN_READY',token:msg.token},origin:new URL(url).origin,source:w}));};
  w.chrome={runtime:{id:'test-extension',onMessage:{addListener:fn=>{listener=fn;}},sendMessage:async msg=>{
    messages.push(msg);
    if(msg.type==='HELLO')return {ok:true,value:structuredClone(state)};
    if(msg.type==='ANSWER')return {ok:true,value:await answer(msg)};
    if(msg.type==='CLAIM_SUBMIT'){state.task.submittedKeys||=[];state.task.submittedKeys.push(msg.key);return {ok:true,value:{claimed:true}};}
    if(msg.type==='STATUS'&&msg.event==='attention')state.active=false;
    return {ok:true,value:{}};
  }}};
  w.eval(source);await flush();
  return {w,messages,state,tick:()=>tick(),setAnswer:fn=>{answer=fn;},scan:()=>new Promise(r=>listener({type:'SCAN'},{id:'test-extension'},r))};
}
test('scan distinguishes completed rows and rejects ambiguous identical titles',async t=>{
  const f=await fixture(t,row+row.replaceAll('课程一','课程二').replace('未开始','已完成'));
  const r=await f.scan();assert.equal(r.ok,true);assert.equal(r.value.length,2);assert.equal(r.value[1].completed,true);
  f.w.document.body.insertAdjacentHTML('beforeend',row);const dup=await f.scan();assert.equal(dup.ok,false);assert.match(dup.error,/同名/);
});
test('an opening task clicks its course only once even if navigation is delayed',async t=>{
  const f=await fixture(t,row);let clicks=0;f.w.document.querySelector('h2').onclick=()=>clicks++;
  f.state.active=true;f.state.task.phase='opening';await f.tick();await f.tick();await f.tick();assert.equal(clicks,1);
});
test('homework is left for manual answers even when legacy autoQA is enabled',async t=>{
  const f=await fixture(t,quiz);let submits=0;f.w.document.querySelector('button').onclick=()=>submits++;
  f.state.active=true;await f.tick();await f.tick();
  assert.equal(submits,0);assert.ok(!f.messages.some(m=>m.type==='ANSWER'||m.type==='CLAIM_SUBMIT'));
  assert.ok([...f.w.document.querySelectorAll('input')].every(i=>!i.checked));
  assert.ok(f.messages.some(m=>m.event==='manual'));
});
test('a security verification pauses the video worker without answering',async t=>{
  const f=await fixture(t,quiz+'<div role="dialog">作答安全核验：请完成安全核验</div>');
  f.state.active=true;await f.tick();
  assert.ok(f.messages.some(m=>m.event==='attention' && /安全核验/.test(m.note)));
  assert.ok(!f.messages.some(m=>m.type==='ANSWER'||m.type==='CLAIM_SUBMIT'));
});
test('AI workspace scan distinguishes videos, homework and completed videos',async t=>{
  const f=await fixture(t,'<div class="leaf-item"><span class="leaf-item-tag">视频</span><span class="leaf-item-title">视频一</span><i class="icon-yuanquangou"></i></div><div class="leaf-item"><span class="leaf-item-tag">作业</span><span class="leaf-item-title">作业一</span></div>');
  const r=await f.scan();assert.equal(r.ok,true);assert.deepEqual(JSON.parse(JSON.stringify(r.value.map(x=>[x.kind,x.completed]))),[['video',true],['homework',false]]);
});
test('a queued AI workspace video already open at its directory address enters playback instead of timing out',async t=>{
  const f=await fixture(t,'<div class="leaf-item is-active"><span class="leaf-item-tag">视频</span><span class="leaf-item-title">课程一</span></div><video></video>');
  f.state.active=true;f.state.task.phase='opening';await f.tick();
  assert.ok(f.messages.some(m=>m.event==='opened'));assert.ok(!f.messages.some(m=>m.event==='attention'));
});
test('a player whose play promise never settles times out and releases the worker',async t=>{
  const f=await fixture(t,'<video></video>');
  const video=f.w.document.querySelector('video');let pauses=0;
  video.play=()=>new Promise(()=>{});video.pause=()=>{pauses++;};
  f.state.active=true;await f.tick();
  assert.ok(f.messages.some(m=>m.event==='attention' && /10 秒/.test(m.note)));
  assert.ok(pauses>0);
  const before=f.messages.filter(m=>m.type==='HELLO').length;await f.tick();
  assert.ok(f.messages.filter(m=>m.type==='HELLO').length>before);
});
test('a hidden page still attempts genuine muted playback and reports its real visibility',async t=>{
  const f=await fixture(t,'<video></video>'),v=f.w.document.querySelector('video');
  let paused=true,plays=0;Object.defineProperty(f.w.document,'visibilityState',{value:'hidden'});
  Object.defineProperty(v,'paused',{get:()=>paused});v.play=async()=>{plays++;paused=false;};v.pause=()=>{paused=true;};
  f.state.active=true;await f.tick();
  assert.equal(plays,1);assert.equal(v.muted,true);
  assert.ok(f.messages.some(m=>m.media?.visible===false && m.media.paused===false && /页面隐藏/.test(m.note)));
  assert.ok(!f.messages.some(m=>m.event==='attention'));
});

const legacyRows='<div class="chapter-list"><div class="header"><span class="pointer"><span class="title">示例章节</span></span></div><div class="content"><div class="leaf-detail"><div class="leaf-title"><i class="icon--shipin"></i><span class="title">课程一</span></div><div class="progress-time">1%</div></div><div class="leaf-detail"><div class="leaf-title"><i class="icon--zuoye"></i><span class="title">示例自测</span></div><div class="progress-time">未开始</div></div></div></div>';
function legacyFrame(f,html=legacyRows) {
  const frame=f.w.document.querySelector('iframe'),child=frame.contentWindow;
  child.HTMLElement.prototype.getClientRects=f.w.HTMLElement.prototype.getClientRects;
  child.HTMLElement.prototype.scrollIntoView=()=>{};
  frame.contentDocument.open();frame.contentDocument.write('<html><body>'+html+'</body></html>');frame.contentDocument.close();
  return {frame,child};
}
test('legacy iframe scan preserves the outer source and excludes hidden duplicate panes',async t=>{
  const f=await fixture(t,'<iframe src="/pro/lms/example/1/studycontent"></iframe>');
  legacyFrame(f,legacyRows+'<section style="display:none">'+legacyRows+'</section>');
  const r=await f.scan();assert.equal(r.ok,true);assert.equal(r.value.length,2);
  assert.deepEqual(JSON.parse(JSON.stringify(r.value.map(x=>[x.url,x.kind,x.completed]))),[[home,'video',false],[home,'homework',false]]);
});
test('legacy completed videos verify from the iframe directory without clicking or submitting',async t=>{
  const f=await fixture(t,'<iframe src="/pro/lms/example/1/studycontent"></iframe>');
  const {child}=legacyFrame(f,legacyRows.replace('1%','100 %'));let clicks=0;child.document.querySelector('.leaf-detail').onclick=()=>clicks++;
  f.state.active=true;f.state.task.phase='verifying';await f.tick();
  assert.ok(f.messages.some(m=>m.event==='verified'));assert.equal(clicks,0);
});
test('legacy iframe window.open handshake is coordinated by the top worker',async t=>{
  const f=await fixture(t,'<iframe src="/pro/lms/example/1/studycontent"></iframe>');
  const {child}=legacyFrame(f);let token,clicks=0;
  child.postMessage=msg=>{if(msg.type==='YKT_ARM_OPEN'){token=msg.token;f.w.dispatchEvent(new f.w.MessageEvent('message',{data:{type:'YKT_OPEN_READY',token},origin:f.w.location.origin,source:child}));}};
  child.document.querySelector('.leaf-detail').onclick=()=>{clicks++;f.w.dispatchEvent(new f.w.MessageEvent('message',{data:{type:'YKT_OPEN_CAPTURED',token,url:'https://pro.yuketang.cn/ai-workspace/lms-graph/1/video/2'},origin:f.w.location.origin,source:child}));};
  f.state.active=true;f.state.task.phase='opening';await f.tick();await f.tick();
  assert.equal(clicks,1);assert.ok(f.messages.some(m=>m.type==='OPEN_UNIT' && m.taskId==='task-1' && m.url.endsWith('/video/2')));
});
test('log scan selects learning content when its units lack deadlines',async t=>{
  const f=await fixture(t,'<div>学习内容</div><h2>公告</h2>已读');
  f.w.document.querySelector('div').onclick=()=>{f.w.history.replaceState(null,'',home+'?tab=content');f.w.document.body.insertAdjacentHTML('beforeend',legacyRows);};
  const r=await f.scan();assert.equal(r.ok,true);assert.equal(r.value.length,2);assert.ok(r.value.every(x=>x.url===home+'?tab=content'));
});
test('legacy collapsed chapters expand once and unknown unit icons are excluded',async t=>{
  const f=await fixture(t,legacyRows.replace('class="content"','class="content" style="display:none"')+'<div class="leaf-detail"><div class="leaf-title"><span class="title">公告</span></div></div>');
  let clicks=0;f.w.document.querySelector('.pointer').onclick=()=>{clicks++;f.w.document.querySelector('.content').style.display='';};
  const r=await f.scan();assert.equal(r.value.length,2);assert.equal(clicks,1);
});
test('hidden AI workspace duplicates do not prevent scanning visible units',async t=>{
  const item='<div class="leaf-item"><span class="leaf-item-tag">视频</span><span class="leaf-item-title">课程一</span></div>';
  const f=await fixture(t,item+'<div hidden>'+item+'</div>');assert.equal((await f.scan()).value.length,1);
});

test('scan excludes non-directory iframe routes even when their DOM has video cards',async t=>{
 const f=await fixture(t,'<iframe src="/unrelated/embedded"></iframe>');legacyFrame(f);assert.equal((await f.scan()).value.length,0);
});
test('hidden learning-log panes do not create duplicate title errors',async t=>{
 const f=await fixture(t,row+'<section style="display:none">'+row+'</section>');const r=await f.scan();assert.equal(r.ok,true);assert.equal(r.value.length,1);
});
