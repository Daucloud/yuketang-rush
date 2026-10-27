// Store screenshots use the real control page with synthetic, read-only Chrome state.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
const files=new Set(['popup.html','popup.css','popup.js','core.js','model.js','diagnostics.js','storage.js']);
const mock=`<style>.demo-banner{position:fixed;top:0;left:0;right:0;background:#e2efec;color:#176d66;text-align:center;font:12px system-ui;padding:6px;z-index:9999}body{padding-top:48px}</style><div class="demo-banner">示例数据 · 不连接课程账户或模型 · 独立开源扩展</div><script>
const demoTasks=[{id:'sample-1',title:'课程视频 01（示例）',phase:'running',note:'静音播放中 · 示例状态'},{id:'sample-2',title:'课程视频 02（示例）',phase:'done',note:'目录显示已完成 · 示例状态'}];
window.chrome={storage:{local:{get:async()=>({})}},permissions:{request:async()=>false},runtime:{sendMessage:async msg=>{if(msg.type==='MODEL_GET')return {ok:true,value:{baseURL:'https://api.deepseek.com',model:'deepseek-flash',hasApiKey:false}};if(msg.type==='GET')return {ok:true,value:{paused:false,tasks:demoTasks,config:{count:2,rate:2,focusWindows:false},displays:[{id:'sample',name:'示例显示器',isPrimary:true,workArea:{width:1440,height:900}}]}};return {ok:false,error:'这是商店截图预览，不操作课程、不保存密钥或调用模型。'};}}};
window.addEventListener('load',()=>{if(new URL(location.href).searchParams.get('view')==='model')document.getElementById('modelState').closest('section').scrollIntoView({block:'start'});});
</script>`;
http.createServer(async(req,res)=>{
  const file=new URL(req.url,'http://127.0.0.1').pathname.slice(1)||'popup.html';
  if(!files.has(file)){res.writeHead(404);res.end();return;}
  let data=await readFile(new URL('../extension/'+file,import.meta.url));
  if(file==='popup.html')data=data.toString().replace('<script type="module"',mock+'<script type="module"');
  res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(data);
}).listen(8768,'127.0.0.1',()=>console.log('商店截图预览：http://127.0.0.1:8768/popup.html?dashboard=1'));
