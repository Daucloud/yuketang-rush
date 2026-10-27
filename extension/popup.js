import {localGet,localSet,localRemove} from './storage.js';
import {courseURL} from './core.js';
import {diagnosticNames} from './diagnostics.js';
import {validateModelSettings,modelOrigin,defaultModelSettings} from './model.js';
const $=id=>document.getElementById(id);
let candidates=[],lastTasks='';
const phaseName={pending:'排队',opening:'打开单元',running:'运行',verifying:'确认完成',done:'已完成',attention:'需处理',skipped:'已跳过',manual:'手动作答'};
async function rpc(msg) {const r=await chrome.runtime.sendMessage(msg);if(!r?.ok)throw Error(r?.error||'扩展未响应');return r.value;}
function message(s,error=false){$('message').textContent=s;$('message').classList.toggle('error',error);}
function modelMessage(text,error=false){$('modelMessage').textContent=text;$('modelMessage').classList.toggle('error',error);}
function bind(id,fn){$(id).onclick=async()=>{const b=$(id),modelAction=['saveModel','testModel','clearModel'].includes(id),label=b.textContent;b.disabled=true;
  if(id==='testModel'){b.textContent='正在测试…';modelMessage('正在测试模型连接与图片输入，最多等待 30 秒…');}
  try{await fn();}catch(e){(modelAction?modelMessage:message)(e.message,true);}finally{b.disabled=false;b.textContent=label;}};}

async function saveCandidates(){await localSet({candidates});}
function renderCandidates(){
  $('candidates').replaceChildren();
  candidates.forEach((c,i)=>{const label=document.createElement('label');label.className='candidate';const cb=document.createElement('input');cb.type='checkbox';cb.disabled=c.kind==='homework';cb.checked=!!c.selected&&!cb.disabled;cb.onchange=()=>{candidates[i].selected=cb.checked;saveCandidates();};const span=document.createElement('span');span.textContent=c.title+(c.kind==='homework'?' · 侧边查看答案建议':c.completed?' · 已完成':'');label.append(cb,span);$('candidates').append(label);});
}
async function currentTab(){const source=new URL(location.href).searchParams.get('sourceTab');const t=source?await chrome.tabs.get(Number(source)):(await chrome.tabs.query({active:true,currentWindow:true}))[0];if(!t?.url)throw Error('找不到当前标签页');courseURL(t.url);return t;}
bind('dashboard',async()=>{const t=await currentTab().catch(()=>null);await chrome.windows.create({type:'normal',width:900,height:760,url:chrome.runtime.getURL('popup.html')+'?dashboard=1'+(t?'&sourceTab='+t.id:'')});window.close();});
if(new URL(location.href).searchParams.has('dashboard')){$('dashboard').hidden=true;document.body.style.width='min(900px, 100%)';document.body.style.margin='auto';}
function add(items){for(const item of items){const existing=candidates.find(c=>c.url===item.url && c.targetTitle===item.targetTitle);if(existing)Object.assign(existing,item,{selected:!item.completed&&item.kind!=='homework'});else candidates.push({...item,selected:!item.completed&&item.kind!=='homework'});}renderCandidates();return saveCandidates();}
bind('scan',async()=>{const t=await currentTab();const r=await chrome.tabs.sendMessage(t.id,{type:'SCAN'},{frameId:0});if(!r?.ok)throw Error(r?.error||'请刷新雨课堂页面后重试');if(!r.value.length)throw Error('未识别到学习单元，请进入学习日志并展开章节，或使用单元独立链接');await add(r.value);message(`读取到 ${r.value.length} 个学习单元`);});
bind('current',async()=>{const t=await currentTab();await add([{url:t.url,title:t.title,targetTitle:''}]);message('当前地址已加入。独立链接结束后需要手动核对完成状态。');});
bind('add',async()=>{const urls=$('urls').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(courseURL);await add(urls.map(url=>({url,title:url,targetTitle:''})));$('urls').value='';});
let savedModel;
function showModelSettings(settings) {
  savedModel=settings;
  $('baseURL').value=settings.baseURL;$('model').value=settings.model;$('apiKey').value='';
  $('apiKey').placeholder=settings.hasApiKey?'已保存密钥；留空保留，填写则替换':'填写你自己的模型密钥';
  $('modelState').textContent=settings.hasApiKey?'已配置':'未配置';
}
bind('saveModel',async()=>{
  const settings={baseURL:$('baseURL').value,model:$('model').value,apiKey:$('apiKey').value};
  const candidate=validateModelSettings({...settings,apiKey:'validation-placeholder'});
  const validated=validateModelSettings({...candidate,apiKey:settings.apiKey.trim() || (savedModel?.hasApiKey && modelOrigin(savedModel.baseURL)===modelOrigin(candidate.baseURL)?'stored-key-placeholder':'')});
  const allowed=await chrome.permissions.request({origins:[modelOrigin(validated.baseURL)]});
  if(!allowed)throw Error('未授予模型站点访问权限，设置未保存');
  showModelSettings(await rpc({type:'MODEL_SAVE',settings}));
  modelMessage('模型设置已保存，可直接收集作业并分析。建议先测试连接。');
});
bind('testModel',async()=>{
  if($('apiKey').value || $('baseURL').value!==savedModel?.baseURL || $('model').value!==savedModel?.model)throw Error('请先保存修改后的模型设置');
  if(!savedModel?.hasApiKey)throw Error('请先填写 API key 并保存模型设置');
  const r=await rpc({type:'MODEL_TEST'});modelMessage(`模型已连接 · ${r.model} · 图片输入测试通过`);
});
bind('clearModel',async()=>{await rpc({type:'MODEL_CLEAR'});showModelSettings({...defaultModelSettings,hasApiKey:false});modelMessage('已删除模型设置、密钥和答案缓存。');});
bind('start',async()=>{await rpc({type:'START',tasks:candidates.filter(c=>c.selected&&c.kind!=='homework'),config:{count:Number($('count').value),rate:Number($('rate').value),displayId:$('display').value,focusWindows:$('focusWindows').checked}});message('静音视频队列已启动。');await refresh();});
for(const [id,type] of [['tile','TILE'],['pause','PAUSE'],['resume','RESUME']])bind(id,async()=>{await rpc({type,...(type==='RESUME'?{focusWindows:$('focusWindows').checked}:{})});message(({TILE:'窗口已重新平铺',PAUSE:'队列已暂停',RESUME:'队列已继续'})[type]);await refresh();});
bind('reload',async()=>{await rpc({type:'RELOAD'});message('课程窗口已刷新，队列保持暂停；准备好后点击「继续队列」。');await refresh();});
bind('exportDiagnostics',async()=>{
  const state=await rpc({type:'GET'});
  const report={exportedAt:new Date().toISOString(),paused:state.paused,
    tasks:state.tasks.map(t=>({title:t.title,phase:t.phase,diagnostic:t.diagnostic,mediaSeenAt:t.mediaSeenAt,mediaHistory:t.mediaHistory||[]}))};
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='yuketang-playback.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  message('已导出本地播放记录。');
});
async function refresh(initial=false){
  const state=await rpc({type:'GET'});
  if(initial){for(const d of state.displays){const o=document.createElement('option');o.value=d.id;o.textContent=`${d.name} · ${d.workArea.width}×${d.workArea.height}${d.isPrimary?' · 主屏':''}`;o.selected=d.id===state.config.displayId || (!state.config.displayId&&d.isPrimary);$('display').append(o);}if(state.config.count)$('count').value=state.config.count;if(state.config.rate)$('rate').value=state.config.rate;$('focusWindows').checked=state.config.focusWindows===true;}
  $('runState').textContent=state.paused?'已暂停':'已启动';const tasksJSON=JSON.stringify(state.tasks);if(tasksJSON===lastTasks)return;lastTasks=tasksJSON;const expanded=new Set([...$('tasks').querySelectorAll('details[open]')].map(d=>d.dataset.taskId));$('tasks').replaceChildren();
  if(!state.tasks.length){$('tasks').textContent='尚未开始队列';return;}
  for(const t of state.tasks){const item=document.createElement('div');item.className='task';const title=document.createElement('b');title.textContent=`${phaseName[t.phase]||t.phase} · ${t.title}`;const note=document.createElement('p');note.textContent=t.note||'';item.append(title,note);
    if(t.mediaSeenAt){const p=document.createElement('p');p.className='hint';p.textContent=`最近观察：${diagnosticNames[t.diagnostic]||'等待观察'} · ${new Date(t.mediaSeenAt).toLocaleTimeString()}${state.paused?'（队列已暂停）':''}`;item.append(p);}
    if(t.mediaHistory?.length){const details=document.createElement('details'),summary=document.createElement('summary');details.dataset.taskId=t.id;details.open=expanded.has(t.id);summary.textContent='最近播放记录';details.append(summary);for(const sample of t.mediaHistory.slice(-8)){const p=document.createElement('p');p.className='hint';p.textContent=`${new Date(sample.at).toLocaleTimeString()} · ${diagnosticNames[sample.condition]||sample.condition}${sample.time!=null?` · ${sample.time}s · ${sample.rate}×`:''}`;details.append(p);}item.append(details);}
    if(t.phase==='attention')for(const [label,type] of [['重试','RETRY'],['跳过此项','SKIP']]){const b=document.createElement('button');b.className='secondary';b.textContent=label;b.onclick=async()=>{try{await rpc({type,id:t.id});await refresh();}catch(e){message(e.message,true);}};item.append(b);}
    $('tasks').append(item);
  }
}
showModelSettings({...defaultModelSettings,hasApiKey:false});
await rpc({type:'MODEL_GET'}).then(showModelSettings).catch(e=>modelMessage(e.message,true));
const saved=await localGet('candidates');candidates=saved.candidates||[];renderCandidates();await refresh(true).catch(e=>message(e.message,true));
setInterval(()=>refresh().catch(()=>{}),2500);
