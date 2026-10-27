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
