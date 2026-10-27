import test from 'node:test';
import assert from 'node:assert/strict';
import {recordMedia,recordGap} from '../extension/diagnostics.js';
const media={time:10,rate:2,visible:true,focused:false,paused:false,stalledFor:0};
test('history samples periodically, retains state transitions, and bounds storage',()=>{
  const task={};recordMedia(task,media,0);recordMedia(task,{...media,time:16},3000);
  assert.equal(task.mediaHistory.length,1);
  recordMedia(task,{...media,visible:false},6000);
  recordMedia(task,{...media,stalledFor:20},9000);
  assert.deepEqual(task.mediaHistory.map(s=>s.condition),['unfocused','hidden','stalled']);
  recordGap(task,70000);recordGap(task,100000);assert.equal(task.mediaHistory.length,4);
  recordMedia(task,media,110000);assert.equal(task.diagnostic,'unfocused');
  for(let i=0;i<200;i++)recordMedia(task,{...media,time:i},122000+i*12000);
  assert.equal(task.mediaHistory.length,180);assert.equal(task.mediaHistory.at(-1).time,199);
});
test('malformed and extra page data cannot enter playback history',()=>{
  const task={};recordMedia(task,{time:NaN,rate:2});assert.equal(task.mediaHistory,undefined);
  recordMedia(task,{...media,account:'secret',stalledFor:-3},0);
  assert.ok(!('account' in task.mediaHistory[0]));assert.equal(task.media.stalledFor,0);
});
