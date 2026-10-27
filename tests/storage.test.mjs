import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {localGet,localSet,localRemove} from '../extension/storage.js';
function fixture(t) {
  const savedChrome=globalThis.chrome,savedIDB=globalThis.indexedDB,data={};
  globalThis.indexedDB=indexedDB;
  globalThis.chrome={storage:{local:{get:async key=>structuredClone({[key]:data[key]}),set:async values=>Object.assign(data,structuredClone(values)),remove:async key=>{delete data[key];}}}};
  t.after(()=>{globalThis.chrome=savedChrome;globalThis.indexedDB=savedIDB;});return data;
}
test('API credentials, course history and advice survive encrypted local storage without plaintext',async t=>{
  const data=fixture(t),values={modelConfig:{apiKey:'private-sample-key',model:'vision-model'},run:{tasks:[{title:'Sample course'}]},adviceCache:{'1:1':{answers:['sample advice']}},candidates:[{url:'https://pro.yuketang.cn/v2/web/studentLog/10001'}]};
  await localSet(values);
  const raw=JSON.stringify(data);for(const text of ['private-sample-key','Sample course','sample advice','studentLog'])assert.ok(!raw.includes(text));
  for(const [key,value] of Object.entries(values))assert.deepEqual((await localGet(key))[key],value);
});
test('legacy plaintext data is migrated without changing the saved API key or task data',async t=>{
  const data=fixture(t);data.modelConfig={apiKey:'old-key',model:'model'};
  assert.deepEqual((await localGet('modelConfig')).modelConfig,{apiKey:'old-key',model:'model'});
  assert.equal(data.modelConfig.encrypted,1);assert.ok(!JSON.stringify(data).includes('old-key'));
  await localRemove('modelConfig');assert.equal((await localGet('modelConfig')).modelConfig,undefined);
});
test('fresh IVs prevent repeated ciphertext and modified or swapped records fail authentication',async t=>{
  const data=fixture(t);await localSet({run:{sample:1}});const first=structuredClone(data.run);
  await localSet({run:{sample:1}});assert.notDeepEqual(data.run.iv,first.iv);
  data.candidates=structuredClone(data.run);await assert.rejects(localGet('candidates'),/无法解密/);
  const tampered=Buffer.from(data.run.data,'base64');tampered[0]^=1;data.run.data=tampered.toString('base64');await assert.rejects(localGet('run'),/无法解密/);
});
test('encryption key is non-extractable and absent from Chrome local storage',async t=>{
  const data=fixture(t);await localSet({modelConfig:{apiKey:'sample'}});
  const key=await new Promise((resolve,reject)=>{const r=indexedDB.open('yuketang-private-storage',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,q=db.transaction('keys').objectStore('keys').get('aes-key');q.onsuccess=()=>{resolve(q.result);db.close();};};});
  assert.equal(key.extractable,false);assert.equal(key.algorithm.name,'AES-GCM');assert.equal(key.algorithm.length,256);
  await assert.rejects(crypto.subtle.exportKey('raw',key));assert.deepEqual(Object.keys(data),['modelConfig']);
});
