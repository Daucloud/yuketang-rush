import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const source=await readFile(new URL('../extension/advice.js',import.meta.url),'utf8');
const quiz=n=>`<section><div class="problem-body">问题${n}</div><label class="el-radio"><input type="radio" name="q" value="A"><span class="radioText">甲${n}</span></label><label class="el-radio"><input type="radio" name="q" value="B"><span class="radioText">乙${n}</span></label><button>提交</button></section>`;
async function flush(predicate){for(let i=0;i<300;i++){await new Promise(r=>setImmediate(r));if(predicate())return;}throw Error('fixture did not settle');}
async function fixture(t,extra='') {
  const html=`<aside class="problems-aside">${[1,2,3].map(n=>`<div class="subject-item J_order ${n===1?'active':''}" data-order="${n}">${n}</div>`).join('')}</aside><main class="container-problem">${quiz(1)}</main>${extra}`;
  const dom=new JSDOM(html,{url:'https://pro.yuketang.cn/v2/web/iframe-exercise/10001/20001',runScripts:'outside-only',pretendToBeVisual:true});t.after(()=>{dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();});
  const w=dom.window,messages=[];let listener,submits=0,model=async qs=>({answers:qs.map(q=>({...q,selected:['B'],uncertain:false,explanation:'依据'})),at:Date.now()});
  w.crypto.randomUUID=()=>crypto.randomUUID();w.HTMLElement.prototype.getClientRects=function(){return this.style.display==='none'?[]:[{width:100,height:30}];};
  w.setTimeout=fn=>setImmediate(fn);
  w.chrome={runtime:{id:'extension-test',onMessage:{addListener:fn=>{listener=fn;}},sendMessage:async msg=>{
    messages.push(structuredClone(msg));
    if(msg.type==='ADVICE_GET')return {ok:true,value:null};
    if(msg.type==='ADVICE_COLLECT_START')listener({type:'COLLECT_ADVICE',requestId:msg.requestId},{id:'extension-test'});
    if(msg.type==='ADVICE_COLLECT_CANCEL')listener({type:'CANCEL_ADVICE',requestId:msg.requestId},{id:'extension-test'});
    if(msg.type==='ADVICE_PROGRESS')listener({type:'ADVICE_UI',exercise:'10001:20001',requestId:msg.requestId,...msg.state},{id:'extension-test'});
    if(msg.type==='ADVICE_BATCH')return {ok:true,value:await model(msg.questions)};
    return {ok:true,value:{}};
  }}};
  const main=w.document.querySelector('main');main.addEventListener('click',e=>{if(e.target.closest('button'))submits++;});
  for(const item of w.document.querySelectorAll('.J_order'))item.onclick=()=>{
    for(const el of w.document.querySelectorAll('.J_order'))el.classList.toggle('active',el===item);
    main.innerHTML=quiz(item.dataset.order);
  };
  w.eval(source);await flush(()=>w.document.querySelector('[data-start]'));
  return {w,messages,submits:()=>submits,model:fn=>{model=fn;},start:()=>w.document.querySelector('[data-start]').click()};
}
test('collects the entire sheet once, restores the original question, and never selects or submits',async t=>{
  const f=await fixture(t);f.start();await flush(()=>f.w.document.querySelectorAll('#ykt-advice-panel article').length===3);
  const batches=f.messages.filter(m=>m.type==='ADVICE_BATCH');assert.equal(batches.length,1);assert.deepEqual(batches[0].questions.map(q=>q.id),['1','2','3']);
  assert.deepEqual(batches[0].questions.map(q=>q.stem),['问题1','问题2','问题3']);assert.equal(f.w.document.querySelector('.J_order.active').dataset.order,'1');
  assert.equal(f.submits(),0);assert.ok([...f.w.document.querySelectorAll('input')].every(i=>!i.checked));
  assert.ok(!f.messages.some(m=>m.type==='ANSWER'||m.type==='CLAIM_SUBMIT'));
});
test('security verification blocks collection before navigation or model requests',async t=>{
  const f=await fixture(t,'<div id="homework-automation-risk-challenge">请完成安全核验</div>');f.start();
  await flush(()=>/安全核验/.test(f.w.document.querySelector('[data-error]').textContent));
  assert.ok(!f.messages.some(m=>m.type==='ADVICE_BATCH'));assert.equal(f.w.document.querySelector('.J_order.active').dataset.order,'1');assert.equal(f.submits(),0);
});
test('verification appearing during collection stops without restoring navigation or sending partial data',async t=>{
  const f=await fixture(t),second=f.w.document.querySelector('[data-order="2"]'),navigate=second.onclick;
  second.onclick=()=>{navigate();f.w.document.body.insertAdjacentHTML('beforeend','<div id="homework-automation-risk-challenge">请完成安全核验</div>');};
  f.start();await flush(()=>/安全核验/.test(f.w.document.querySelector('[data-error]').textContent));
  assert.equal(f.w.document.querySelector('.J_order.active').dataset.order,'2');assert.ok(!f.messages.some(m=>m.type==='ADVICE_BATCH'));assert.equal(f.submits(),0);
});
test('existing unsaved choices are preserved and stop collection',async t=>{
  const f=await fixture(t);f.w.document.querySelector('input').checked=true;f.start();
  await flush(()=>/未提交/.test(f.w.document.querySelector('[data-error]').textContent));
  assert.equal(f.w.document.querySelector('input').checked,true);assert.ok(!f.messages.some(m=>m.type==='ADVICE_BATCH'));
});
test('an unsupported image question prevents sending a partial sheet',async t=>{
  const f=await fixture(t);f.w.document.querySelector('.problem-body').insertAdjacentHTML('beforeend','<img src="x">');f.start();
  await flush(()=>/插图/.test(f.w.document.querySelector('[data-error]').textContent));assert.ok(!f.messages.some(m=>m.type==='ADVICE_BATCH'));
});
test('cancelling a pending analysis prevents late answers from being displayed',async t=>{
  const f=await fixture(t);let resolve;f.model(()=>new Promise(r=>{resolve=r;}));f.start();await flush(()=>!!resolve);
  f.w.document.querySelector('[data-cancel]').click();await flush(()=>f.messages.some(m=>m.type==='ADVICE_CANCEL'));
  resolve({answers:[{id:'1',stem:'晚到的答案',options:[{id:'B',text:'乙'}],selected:['B'],uncertain:false,explanation:''}]});
  await flush(()=>f.w.document.querySelector('[data-start]').disabled===false);await new Promise(r=>setImmediate(r));
  assert.equal(f.w.document.querySelectorAll('#ykt-advice-panel article').length,0);assert.equal(f.submits(),0);
});
test('advice text is rendered as text and uncertain questions show no recommended choice',async t=>{
  const f=await fixture(t);f.model(async qs=>({answers:qs.map(q=>({...q,stem:'<img src=x onerror=alert(1)>',selected:[],uncertain:true,explanation:'口径冲突'}))}));
  f.start();await flush(()=>f.w.document.querySelectorAll('#ykt-advice-panel article').length===3);
  assert.equal(f.w.document.querySelectorAll('#ykt-advice-panel img').length,0);assert.match(f.w.document.querySelector('article strong').textContent,/暂不建议作答/);
});
