import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeBatch,testModelConnection,validateModelSettings} from '../extension/model.js';
const settings={baseURL:'https://model.example/v1',model:'vision-model',apiKey:'private-test-key'};
const image='iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFElEQVR4nGP4TyJgGNUwqmH4agAAr639H708R/EAAAAASUVORK5CYII=';
const question=id=>({id,kind:'single',stem:'问题 '+id,options:[{id:'A',text:'甲'},{id:'B',text:'乙'}]});
const answer=q=>({...q,selected:['B'],uncertain:false,explanation:'依据'});
const response=output=>Response.json({choices:[{message:{content:typeof output==='string'?output:JSON.stringify(output)}}]});
test('direct visual batch uses one provider request, preserves image IDs, and maps reordered answers',async()=>{
  const qs=[{...question('1'),rendered:[image,image,image]},question('2')];let calls=0;
  const result=await analyzeBatch(settings,{questions:qs},{fetchImpl:async(url,opts)=>{
    calls++;assert.equal(url,'https://model.example/v1/chat/completions');assert.equal(opts.redirect,'error');assert.equal(opts.headers.Authorization,'Bearer private-test-key');
    const body=JSON.parse(opts.body);assert.equal(body.stream,true);
    assert.ok(!opts.body.includes('private-test-key'));assert.equal(body.messages[1].content.filter(p=>p.type==='image_url').length,3);
    assert.deepEqual(body.messages[1].content.filter(p=>p.text?.startsWith('选项')).map(p=>p.text),['选项 id=A','选项 id=B']);
    return response({answers:qs.map(answer).reverse()});
  }});
  assert.equal(calls,1);assert.deepEqual(result.answers.map(a=>a.id),['1','2']);assert.ok(!JSON.stringify(result).includes('rendered'));
});
test('direct model rejects malformed images and incomplete or mismatched answers',async()=>{
  await assert.rejects(analyzeBatch(settings,{questions:[{...question('1'),rendered:['bad']}]},{fetchImpl:async()=>{throw Error('must not call');}}),/图片格式/);
  for(const output of [{answers:[]},{answers:[{...answer(question('1')),selected:['X']}]},{answers:[answer(question('wrong'))]}]) {
    await assert.rejects(analyzeBatch(settings,{questions:[question('1')]},{fetchImpl:async()=>response(output)}),/模型/);
  }
  const visual={...question('1'),rendered:[image,image,image]};
  const {stem,options,...withoutTranscription}=answer(visual);
  await assert.rejects(analyzeBatch(settings,{questions:[visual]},{fetchImpl:async()=>response({answers:[withoutTranscription]})}),/转写/);
});
test('API endpoint validation allows HTTPS and loopback HTTP, without embedded credentials or completion path',()=>{
  for(const baseURL of ['http://model.example/v1','file:///tmp/model','https://user:pass@model.example','https://model.example?key=secret','https://model.example/#key','https://model.example/v1/chat/completions'])assert.throws(()=>validateModelSettings({...settings,baseURL}));
  for(const baseURL of ['https://model.example/v1/','http://127.0.0.1:9000/v1','http://localhost:9000','http://[::1]:9000'])assert.ok(validateModelSettings({...settings,baseURL}).baseURL);
  assert.throws(()=>validateModelSettings({...settings,apiKey:'a\nb'}));
});
test('provider errors and network errors never expose keys or raw upstream bodies',async()=>{
  for(const fetchImpl of [async()=>new Response('private-test-key provider error',{status:401}),async()=>{throw Error('private-test-key network error');},async()=>Response.json({error:'private-test-key'})]) {
    await assert.rejects(analyzeBatch(settings,{questions:[question('1')]},{fetchImpl}),error=>!error.message.includes('private-test-key'));
  }
});
test('connection test actually sends an image to the saved model',async()=>{
  const result=await testModelConnection(settings,{fetchImpl:async(url,opts)=>{
    const body=JSON.parse(opts.body);assert.equal(body.messages[0].content[1].type,'image_url');assert.equal(body.max_tokens,16);return response('OK');
  }});assert.equal(result.vision,true);
});
test('streaming responses survive split UTF-8 and SSE boundaries without mixing reasoning text',async()=>{
  const content=JSON.stringify({answers:[answer(question('1'))]});
  const events=[{choices:[{delta:{reasoning_content:'不要混入答案'}}]},...Array.from(content).map(s=>({choices:[{delta:{content:s}}]}))];
  const bytes=new TextEncoder().encode(events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join('')+'data: [DONE]\r\n\r\n');
  const result=await analyzeBatch(settings,{questions:[question('1')]},{fetchImpl:async()=>new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));controller.close();}}),{headers:{'Content-Type':'text/event-stream'}})});
  assert.equal(result.answers[0].stem,'问题 1');assert.equal(result.answers[0].explanation,'依据');
});
test('truncated and oversized model outputs fail with a useful message',async()=>{
  await assert.rejects(analyzeBatch(settings,{questions:[question('1')]},{fetchImpl:async()=>Response.json({choices:[{finish_reason:'length',message:{content:'partial'}}]})}),/长度上限/);
  await assert.rejects(analyzeBatch(settings,{questions:[question('1')]},{fetchImpl:async()=>new Response('x'.repeat(1000001))}),/响应过大/);
});
test('cancel aborts a direct model request instead of displaying late answers',async()=>{
  const controller=new AbortController();
  const pending=analyzeBatch(settings,{questions:[question('1')]},{signal:controller.signal,fetchImpl:async(url,opts)=>new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}))});
  controller.abort();await assert.rejects(pending,/已取消/);
});
