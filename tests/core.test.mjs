import test from 'node:test';
import assert from 'node:assert/strict';
import {tileRects,courseURL,validateAnswer,validateQuestion} from '../extension/core.js';
const q={kind:'single',stem:'选择正确项',options:[{id:'A',text:'甲'},{id:'B',text:'乙'}]};
test('all supported tile counts stay within negative-coordinate screen and never overlap',()=>{
  const area={left:-1920,top:35,width:1920,height:1045};
  for(let n=1;n<=4;n++){
    const rects=tileRects(area,n);
    for(const r of rects){assert.ok(r.left>=area.left&&r.top>=area.top);assert.ok(r.left+r.width<=area.left+area.width);assert.ok(r.top+r.height<=area.top+area.height);}
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){const a=rects[i],b=rects[j];assert.ok(a.left+a.width<=b.left||b.left+b.width<=a.left||a.top+a.height<=b.top||b.top+b.height<=a.top);}
  }
});
test('small screens and invalid concurrency fail before creating windows',()=>{
  assert.throws(()=>tileRects({left:0,top:0,width:700,height:500},4));
  for(const n of [0,5,NaN,1.5])assert.throws(()=>tileRects({width:1920,height:1080},n));
});
test('course navigation cannot leave the intended host',()=>{
  assert.equal(courseURL('https://pro.yuketang.cn/v2/web/studentLog/1'),'https://pro.yuketang.cn/v2/web/studentLog/1');
  for(const url of ['https://pro.yuketang.cn.evil.example','javascript:alert(1)','http://pro.yuketang.cn','https://user:secret@pro.yuketang.cn'])assert.throws(()=>courseURL(url));
});
test('answers reject unknown choices, duplicates, multiple single-choice picks and malformed questions',()=>{
  const a={selected:['B'],uncertain:false,explanation:'依据'};
  assert.deepEqual(validateAnswer(a,q),a);
  for(const selected of [['Z'],['A','A'],['A','B'],[]])assert.throws(()=>validateAnswer({...a,selected},q));
  assert.throws(()=>validateQuestion({...q,options:[q.options[0],q.options[0]]}));
  assert.throws(()=>validateAnswer({...a,uncertain:'false'},q));
  assert.deepEqual(validateAnswer({...a,selected:[],uncertain:true},q).selected,[]);
});
