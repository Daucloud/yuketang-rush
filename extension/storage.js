// User data is encrypted at rest. The non-extractable AES key belongs to this
// extension's IndexedDB origin; it is never placed alongside local ciphertext.
let keyPromise;
function encryptionKey() {
  if(keyPromise)return keyPromise;
  keyPromise=(async()=>{
    const candidate=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    const db=await new Promise((resolve,reject)=>{
      const request=indexedDB.open('yuketang-private-storage',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('keys');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(Error('无法打开本地加密存储'));
      request.onblocked=()=>reject(Error('本地加密存储被占用，请重新加载扩展'));
    });
    try {
      return await new Promise((resolve,reject)=>{
        // Read/write transaction serializes key creation across popup and worker.
        const transaction=db.transaction('keys','readwrite'),store=transaction.objectStore('keys');let key;
        const request=store.get('aes-key');
        request.onsuccess=()=>{key=request.result||candidate;if(!request.result)store.put(key,'aes-key');};
        transaction.oncomplete=()=>resolve(key);
        transaction.onerror=transaction.onabort=()=>reject(Error('无法初始化本地加密存储'));
      });
    } finally {db.close();}
  })().catch(error=>{keyPromise=undefined;throw error;});
  return keyPromise;
}
async function encrypt(name,value) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(name)},await encryptionKey(),new TextEncoder().encode(JSON.stringify(value)));
  return {encrypted:1,iv:Array.from(iv),data:Array.from(new Uint8Array(data))};
}
export async function localSet(values) {
  const encrypted={};
  for(const [name,value] of Object.entries(values))encrypted[name]=await encrypt(name,value);
  await chrome.storage.local.set(encrypted);
}
export async function localGet(name) {
  const stored=(await chrome.storage.local.get(name))[name];
  if(stored===undefined)return {[name]:undefined};
  if(stored?.encrypted!==1) {
    // Upgrade legacy plaintext without requiring the user to re-enter a key.
    await localSet({[name]:stored});return {[name]:stored};
  }
  try {
    const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(stored.iv),additionalData:new TextEncoder().encode(name)},await encryptionKey(),new Uint8Array(stored.data));
    return {[name]:JSON.parse(new TextDecoder().decode(plaintext))};
  } catch {throw Error('本地数据无法解密，请重新配置模型或清除扩展数据后重试');}
}
export const localRemove=name=>chrome.storage.local.remove(name);
