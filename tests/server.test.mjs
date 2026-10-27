import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer,parseAnswer} from '../server.mjs';
const q={kind:'single',stem:'选择正确项',options:[{id:'A',text:'甲'},{id:'B',text:'乙'}]};
const answer={selected:['B'],uncertain:false,explanation:'中文依据'};
const token='test-token-with-at-least-24-characters';
async function serve(t,fetchImpl,recognize,extra={}){const s=createServer({baseURL:'https://llm.example/v1',model:'test',apiKey:'upstream-secret',bridgeToken:token,fetchImpl,recognize,...extra});s.listen(0,'127.0.0.1');await once(s,'listening');t.after(()=>new Promise(r=>s.close(r)));return `http://127.0.0.1:${s.address().port}`;}
const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
test('bridge rejects unauthorized requests and page origins without reaching upstream',async t=>{
  let calls=0;const url=await serve(t,async()=>{calls++;throw Error('unexpected');});
  assert.equal((await fetch(url+'/qa',{method:'POST',body:JSON.stringify(q)})).status,401);
  assert.equal((await fetch(url+'/qa',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:JSON.stringify(q)})).status,403);
  assert.equal(calls,0);
});
test('only the question payload reaches configured API; UTF-8 split chunks survive',async t=>{
  const url=await serve(t,async(target,opts)=>{
    assert.equal(String(target),'https://llm.example/v1/chat/completions');assert.equal(opts.headers.Authorization,'Bearer upstream-secret');
    const req=JSON.parse(opts.body);assert.equal(req.model,'test');assert.deepEqual(JSON.parse(req.messages[1].content),q);assert.equal(req.messages.length,2);
    const bytes=Buffer.from(JSON.stringify({choices:[{message:{content:JSON.stringify(answer)}}]}));
    return new Response(new ReadableStream({start(c){for(const b of bytes)c.enqueue(Uint8Array.of(b));c.close();}}));
  });
  const res=await fetch(url+'/qa',{method:'POST',headers,body:JSON.stringify(q)});assert.equal(res.status,200);assert.deepEqual(await res.json(),answer);
});
test('upstream errors do not expose provider response body',async t=>{
  const url=await serve(t,async()=>new Response('private-upstream-error',{status:401}));
  const r=await fetch(url+'/qa',{method:'POST',headers,body:JSON.stringify(q)});assert.equal(r.status,502);assert.equal((await r.json()).error,'LLM 接口返回 HTTP 401');
});
test('bad model output fails validation',()=>{
  assert.deepEqual(parseAnswer('```json\n'+JSON.stringify(answer)+'\n```',q),answer);
  assert.throws(()=>parseAnswer('{"selected":["C"],"uncertain":false,"explanation":""}',q));
});
test('rendered question is recognized locally and images never reach the model',async t=>{
  const decoded={...q,stem:'识别后的题干'};let recognized=false;
  const url=await serve(t,async(target,opts)=>{
    assert.ok(recognized);assert.deepEqual(JSON.parse(JSON.parse(opts.body).messages[1].content),decoded);
    return Response.json({choices:[{message:{content:JSON.stringify(answer)}}]});
  },async(input,images)=>{assert.deepEqual(input,q);assert.deepEqual(images,['local-image']);recognized=true;return decoded;});
  const res=await fetch(url+'/qa',{method:'POST',headers,body:JSON.stringify({...q,rendered:['local-image']})});assert.equal(res.status,200);
});
test('OCR failure stops before calling the model',async t=>{
  let called=false;const url=await serve(t,async()=>{called=true;},async()=>{throw Error('题目识别失败');});
  const res=await fetch(url+'/qa',{method:'POST',headers,body:JSON.stringify({...q,rendered:['local-image']})});assert.equal(res.status,400);assert.equal(called,false);
});
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
test('official DeepSeek Flash sends rendered images directly with option IDs, bypassing OCR',async t=>{
  let calls=0;const url=await serve(t,async(target,opts)=>{
    calls++;const payload=JSON.parse(opts.body),content=payload.messages[1].content;
    assert.deepEqual(JSON.parse(content[0].text).options,[{id:'A'},{id:'B'}]);
    assert.deepEqual(content.filter(p=>p.type==='text').slice(1).map(p=>p.text),['题干','选项 id=A','选项 id=B']);
    assert.equal(content.filter(p=>p.type==='image_url').length,3);
    assert.equal(content[2].image_url.url,'data:image/png;base64,'+png);
    assert.ok(!JSON.stringify(content).includes(q.stem));
    return Response.json({choices:[{message:{content:JSON.stringify(answer)}}]});
  },async()=>{throw Error('OCR should not be called');},{baseURL:'https://api.deepseek.com',model:'deepseek-flash'});
  assert.equal((await(await fetch(url+'/health',{headers})).json()).vision,true);
  const res=await fetch(url+'/qa',{method:'POST',headers,body:JSON.stringify({...q,rendered:[png,png,png],account:'private'})});
  assert.equal(res.status,200);assert.deepEqual(await res.json(),answer);assert.equal(calls,1);
  const invalid=await fetch(url+'/qa',{method:'POST',headers,body:JSON.stringify({...q,rendered:['invalid']})});
  assert.equal(invalid.status,400);assert.equal(calls,1);
});
test('a full homework batch uses one model call and maps reordered results to original question and option order',async t=>{
  let calls=0;
  const questions=[{id:'1',...q},{id:'2',...q,stem:'第二题'}];
  const url=await serve(t,async(target,opts)=>{
    calls++;const payload=JSON.parse(opts.body);assert.deepEqual(JSON.parse(payload.messages[1].content),{questions});
    return Response.json({choices:[{message:{content:JSON.stringify({answers:[{id:'2',...answer,stem:'第二题明文',options:[q.options[1],q.options[0]]},{id:'1',...answer}]})}}]});
  });
  const r=await fetch(url+'/qa/batch',{method:'POST',headers,body:JSON.stringify({questions,privateAccount:'never forward'})});
  assert.equal(r.status,200);const result=await r.json();assert.equal(calls,1);
  assert.deepEqual(result.answers.map(a=>a.id),['1','2']);assert.equal(result.answers[1].stem,'第二题明文');assert.deepEqual(result.answers[1].options,q.options);
});
test('missing or duplicated batch answers fail instead of showing partial or mismatched advice',async t=>{
  const questions=[{id:'1',...q},{id:'2',...q}];
  let output={answers:[{id:'1',...answer}]};
  const url=await serve(t,async()=>Response.json({choices:[{message:{content:JSON.stringify(output)}}]}));
  assert.equal((await fetch(url+'/qa/batch',{method:'POST',headers,body:JSON.stringify({questions})})).status,400);
  output={answers:[{id:'1',...answer},{id:'1',...answer}]};
  assert.equal((await fetch(url+'/qa/batch',{method:'POST',headers,body:JSON.stringify({questions})})).status,400);
});
test('a visual batch preserves each image-to-question association in one request',async t=>{
  let calls=0;const questions=[{id:'1',...q,rendered:[png,png,png]},{id:'2',...q,rendered:[png,png,png]}];
  const url=await serve(t,async(target,opts)=>{
    calls++;const content=JSON.parse(opts.body).messages[1].content;
    const blocks=content.filter(c=>c.type==='text'&&c.text.startsWith('{')).map(c=>JSON.parse(c.text));
    assert.deepEqual(blocks.map(b=>b.id),['1','2']);assert.equal(content.filter(c=>c.type==='image_url').length,6);
    return Response.json({choices:[{message:{content:JSON.stringify({answers:questions.map(p=>({id:p.id,stem:p.stem,options:p.options,...answer}))})}}]});
  },async()=>{throw Error('OCR should not be called');},{baseURL:'https://api.deepseek.com',model:'deepseek-flash'});
  const r=await fetch(url+'/qa/batch',{method:'POST',headers,body:JSON.stringify({questions})});assert.equal(r.status,200);assert.equal(calls,1);
});
test('a visual batch without model transcription is rejected instead of displaying font-obfuscated text',async t=>{
  const url=await serve(t,async()=>Response.json({choices:[{message:{content:JSON.stringify({answers:[{id:'1',...answer}]})}}]}),undefined,{baseURL:'https://api.deepseek.com',model:'deepseek-flash'});
  const r=await fetch(url+'/qa/batch',{method:'POST',headers,body:JSON.stringify({questions:[{id:'1',...q,rendered:[png,png,png]}]})});
  assert.equal(r.status,400);assert.match((await r.json()).error,/转写/);
});
