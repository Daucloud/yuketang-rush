import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const source=await readFile(new URL('../extension/open-unit.js',import.meta.url),'utf8');
test('only an armed directory action intercepts a popup, consumes its token and preserves normal opens',()=>{
  const dom=new JSDOM('',{url:'https://pro.yuketang.cn/v2/web/studentLog/1',runScripts:'outside-only'});
  const w=dom.window, messages=[], opened=[];
  w.open=(...args)=>{opened.push(args);return 'original';};w.postMessage=msg=>messages.push(msg);
  w.eval(source);
  assert.equal(w.open('/video/1'),'original');
  const arm=(origin='https://pro.yuketang.cn')=>w.dispatchEvent(new w.MessageEvent('message',{source:w,origin,data:{type:'YKT_ARM_OPEN',token:'one'}}));
  arm('https://evil.example');assert.equal(w.open('/video/1'),'original');
  arm();assert.equal(w.open('/video/2'),null);
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))),{type:'YKT_OPEN_CAPTURED',token:'one',url:'https://pro.yuketang.cn/video/2'});
  assert.equal(w.open('/video/3'),'original');
  arm();assert.equal(w.open('https://evil.example/'),null);assert.equal(opened.length,3);
  dom.window.close();
});

test('a legacy child accepts its same-origin parent and replies to that parent only',()=>{
 const dom=new JSDOM('<iframe src="https://pro.yuketang.cn/pro/lms/example/1/studycontent"></iframe>',{url:'https://pro.yuketang.cn/v2/web/studentLog/1',runScripts:'outside-only'});
 const parent=dom.window,w=parent.document.querySelector('iframe').contentWindow,received=[],local=[],opened=[];
 w.open=(...args)=>{opened.push(args);return 'original';};parent.postMessage=msg=>received.push(msg);w.postMessage=msg=>local.push(msg);w.eval(source);
 const arm=(sender,origin='https://pro.yuketang.cn')=>w.dispatchEvent(new w.MessageEvent('message',{source:sender,origin,data:{type:'YKT_ARM_OPEN',token:'parent-one'}}));
 arm(parent,'https://evil.example');assert.equal(w.open('/video/1'),'original');
 arm({postMessage:()=>{}});assert.equal(w.open('/video/1'),'original');
 arm(parent);assert.equal(received.at(-1).type,'YKT_OPEN_READY');assert.equal(w.open('https://pro.yuketang.cn/video/2'),null);
 assert.deepEqual(JSON.parse(JSON.stringify(received.at(-1))),{type:'YKT_OPEN_CAPTURED',token:'parent-one',url:'https://pro.yuketang.cn/video/2'});
 assert.equal(local.length,0);assert.equal(w.open('/video/3'),'original');assert.equal(opened.length,3);dom.window.close();
});
