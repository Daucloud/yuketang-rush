(() => {
  if(globalThis.__yktAdvice) return;
  globalThis.__yktAdvice=true;
  const isTop=window===window.top;
  const all=(selector,root=document)=>[...root.querySelectorAll(selector)];
  const text=el=>(el?.innerText||el?.textContent||'').replace(/\s+/g,' ').trim();
  const visible=el=>!!el && el.getClientRects().length>0 && getComputedStyle(el).visibility!=='hidden';
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function rpc(msg) {const r=await chrome.runtime.sendMessage(msg);if(!r?.ok)throw Error(r?.error||'扩展连接中断');return r.value;}
  function exercise() {
    const m=location.pathname.match(/(?:iframe-exercise\/|lms-graph\/)(\d+)\/(?:exercise\/)?(\d+)/);
    return /exercise/.test(location.pathname) && m?m[1]+':'+m[2]:null;
  }
  function readQuestions() {
    return all('.problem-body').filter(visible).map(body=>{
      let root=body.parentElement;
      while(root && root.querySelectorAll('.problem-body').length===1) {
        const labels=all('label.el-radio,label.el-checkbox',root).filter(visible);
        if(labels.length>=2) {
          const options=labels.map((label,i)=>({id:String(label.querySelector('input')?.value||i+1),text:text(label.querySelector('.radioText,.checkboxText'))||text(label),label,input:label.querySelector('input')}));
          return {body,root,options,q:{kind:labels.some(l=>l.classList.contains('el-checkbox'))?'multiple':'single',stem:text(body),options:options.map(({id,text})=>({id,text}))},hasImages:all('img,canvas',root).some(visible)};
        }
        root=root.parentElement;
      }
      throw Error('含填空、简答或无法识别的题型，尚未收齐全部题目');
    });
  }
  async function renderQuestion(problem) {
    if(!document.fonts) return undefined;
    await document.fonts.ready;
    const fields=[problem.body,...problem.options.map(o=>o.label.querySelector('.radioText,.checkboxText')||o.label)];
    return fields.map(root=>{
      const canvas=document.createElement('canvas');canvas.width=1400;canvas.height=4200;
      const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='black';ctx.textBaseline='top';
      let x=24,y=24,count=0;const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()) {
        const node=walker.currentNode,parent=node.parentElement;
        if(!visible(parent)||/^(SCRIPT|STYLE)$/.test(parent.tagName))continue;
        const css=getComputedStyle(parent);ctx.font=`${css.fontStyle} ${css.fontWeight} 36px ${css.fontFamily}`;
        for(const ch of node.textContent.replace(/\s+/g,' ')) {
          if(++count>12000)throw Error('题目过长，未能完整读取');
          const width=ctx.measureText(ch).width;if(x+width>1376){x=24;y+=54;}if(y>4100)throw Error('题目过长，未能完整读取');
          ctx.fillText(ch,x,y);x+=width;
        }
      }
      if(!count)throw Error('题目画面为空');
      const cropped=document.createElement('canvas');cropped.width=1400;cropped.height=y+76;cropped.getContext('2d').drawImage(canvas,0,0);
      return cropped.toDataURL('image/png').split(',')[1];
    });
  }
  function blocked() {
    if(all('#homework-automation-risk-challenge').some(visible)||all('[role="dialog"],.el-dialog').some(el=>visible(el)&&/作答安全核验|请完成安全核验/.test(text(el)))) return '出现安全核验，已停止收集，请手动完成后重新收集';
    if(all('.homework-problem-change-guard-dialog,.homework-problem-batch-submit-dialog').some(visible)) return '页面要求确认未保存答案，已停止收集；请你处理后重新收集';
    return null;
  }
  const navItems=()=>all('.problems-aside .subject-item.J_order[data-order]');
  const activeOrder=()=>navItems().find(el=>el.classList.contains('active'))?.getAttribute('data-order')||null;
  const marker=()=>JSON.stringify(readQuestions().map(p=>p.q));
  let collection=null;
  async function progress(requestId,state) {await rpc({type:'ADVICE_PROGRESS',requestId,state});}
  async function collect(requestId) {
    if(collection) {await progress(requestId,{error:'已有收集或分析在进行，请先取消'});return;}
    const job={cancelled:false,exercise:exercise()};collection=job;
    const check=()=>{if(job.cancelled||exercise()!==job.exercise)throw Error('本次收集已取消');const reason=blocked();if(reason)throw Error(reason);};
    const collected=[];const original=activeOrder();let completed=false;
    try {
      check();
      const initial=readQuestions();
      if(initial.some(p=>p.options.some(o=>!o.input?.disabled && o.input?.checked))) throw Error('当前题已有未提交的选择，请先自行提交或清除，再收集全部题目');
      const orders=navItems().map(el=>el.getAttribute('data-order'));
      if(orders.length>100 || new Set(orders).size!==orders.length)throw Error('题号过多或重复，无法完整收集');
      async function capture(id,problem) {
        check();if(problem.hasImages)throw Error(`第 ${id} 题含插图，当前适配器不能完整读取；未向模型发送不完整作业`);
        const rendered=await renderQuestion(problem);check();
        collected.push({id,...problem.q,...(rendered?{rendered}:{})});
      }
      if(!orders.length) {
        if(!initial.length)throw Error('题目尚未加载');
        for(let i=0;i<initial.length;i++)await capture(String(i+1),initial[i]);
      } else {
        for(const order of orders) {
          check();let previous=null;
          if(activeOrder()!==order) {
            previous=marker();
            const target=navItems().find(el=>el.getAttribute('data-order')===order);
            if(!target)throw Error('题号列表发生变化，请重新收集');
            target.click();
          }
          const start=Date.now();let stable=null,ready=null;
          while(Date.now()-start<15000) {
            check();const qs=readQuestions(),current=JSON.stringify(qs.map(p=>p.q));
            if(activeOrder()===order && qs.length===1 && qs[0].q.stem && (previous===null||current!==previous)) {
              if(stable===current){ready=qs[0];break;}stable=current;
            } else stable=null;
            await sleep(200);
          }
          if(!ready)throw Error(`第 ${order} 题未能确认加载完成；未发送不完整作业`);
          await capture(order,ready);await progress(requestId,{message:`正在收集题面 ${collected.length}/${orders.length}`,current:order});
        }
      }
      check();completed=true;
      // Restore only after a complete collection, never while a guard or verification is open.
      if(original && activeOrder()!==original)navItems().find(el=>el.getAttribute('data-order')===original)?.click();
      await sleep(250);check();
      await progress(requestId,{message:`已收齐 ${collected.length} 题，正在一次性分析全部题目…`});
      const result=await rpc({type:'ADVICE_BATCH',questions:collected});check();
      await progress(requestId,{result,message:`已分析全部 ${result.answers.length} 题${result.cached?'（使用本地缓存）':''}`});
    } catch(error) {
      if(!job.cancelled)await progress(requestId,{error:error.message,message:completed?'分析未完成':'尚未收齐全部题面'});
    } finally {if(collection===job)collection=null;}
  }
  let panel=null,requestId=null,currentExercise=null,current=null,lastOrder=null;
  function node(tag,value) {const el=document.createElement(tag);if(value!==undefined)el.textContent=value;return el;}
  function renderResults(result) {
    const list=panel.querySelector('[data-results]');list.replaceChildren();
    for(const answer of result.answers||[]) {
      const item=node('article');item.dataset.order=answer.id;
      item.append(node('h3',`第 ${answer.id} 题${answer.uncertain?' · 需核实':''}`),node('p',answer.stem));
      const choices=answer.selected.map(id=>{
        const index=answer.options.findIndex(o=>o.id===id),o=answer.options[index];
        return `${String.fromCharCode(65+index)} · ${o?.text||id}`;
      });
      item.append(node('strong',answer.uncertain?'暂不建议作答':choices.join('；')),node('p',answer.explanation));
      item.classList.toggle('uncertain',answer.uncertain);list.append(item);
    }
    panel.querySelector('[data-cancel]').disabled=true;panel.querySelector('[data-start]').disabled=false;highlight();
  }
  function highlight() {if(panel)for(const item of panel.querySelectorAll('article'))item.classList.toggle('current',item.dataset.order===current);}
  function ensurePanel() {
    if(!isTop)return;
    const key=exercise();
    if(!key) {panel?.remove();document.documentElement.classList.remove('ykt-advice-open');panel=null;currentExercise=null;return;}
    if(panel && currentExercise===key)return;
    panel?.remove();currentExercise=key;requestId=null;current=null;
    panel=node('aside');panel.id='ykt-advice-panel';panel.setAttribute('aria-label','作业答案建议');
    panel.innerHTML=`<style>
      #ykt-advice-panel{position:fixed;right:12px;top:76px;width:330px;max-width:90vw;max-height:82vh;z-index:2147483646;background:#fff;color:#172a38;border:1px solid #ccd8e1;border-radius:12px;box-shadow:0 5px 24px #172a3820;font:14px/1.55 system-ui;overflow:auto}
      #ykt-advice-panel header{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #e5ebf0}#ykt-advice-panel h2{font-size:16px;margin:0}
      #ykt-advice-panel button{font:inherit;cursor:pointer;border:1px solid #ccd8e1;border-radius:7px;background:#f3f7fa;color:#172a38;padding:6px 10px}#ykt-advice-panel button:disabled{opacity:.5;cursor:default}
      #ykt-advice-panel .body{padding:12px 14px}#ykt-advice-panel p{margin:8px 0;overflow-wrap:anywhere}#ykt-advice-panel small{color:#536777}#ykt-advice-panel .buttons{display:flex;gap:6px;flex-wrap:wrap}
      #ykt-advice-panel article{padding:10px 8px;border-top:1px solid #e5ebf0;border-left:3px solid transparent}#ykt-advice-panel h3{font-size:14px;margin:0}#ykt-advice-panel article.current{border-left-color:#326de6;background:#f1f6ff}#ykt-advice-panel article.uncertain strong{color:#a36800}#ykt-advice-panel [data-error]{color:#a33c32}
      #ykt-advice-panel.collapsed{width:180px}#ykt-advice-panel.collapsed .body{display:none}
      @media(min-width:1200px){html.ykt-advice-open body{margin-right:354px!important}}
    </style><header><h2>作业答案建议</h2><button data-toggle>收起</button></header><div class="body"><small>模型一次分析整份作业；你自行选择和提交。</small><p>收集时会切换题号。请先处理当前题的未保存选择。</p><div class="buttons"><button data-start>收集全部并分析</button><button data-cancel disabled>取消</button><button data-clear>清除建议</button></div><p data-status role="status">准备好后开始收集题面。</p><p data-error></p><div data-results></div></div>`;
    document.documentElement.append(panel);
    document.documentElement.classList.add('ykt-advice-open');
    panel.querySelector('[data-toggle]').onclick=()=>{panel.classList.toggle('collapsed');document.documentElement.classList.toggle('ykt-advice-open',!panel.classList.contains('collapsed'));panel.querySelector('[data-toggle]').textContent=panel.classList.contains('collapsed')?'展开':'收起';};
    panel.querySelector('[data-start]').onclick=async()=>{
      requestId=crypto.randomUUID();panel.querySelector('[data-error]').textContent='';panel.querySelector('[data-start]').disabled=true;panel.querySelector('[data-cancel]').disabled=false;panel.querySelector('[data-status]').textContent='正在收集全部题面…';
      try {await rpc({type:'ADVICE_COLLECT_START',requestId});} catch(e){showError(e.message);}
    };
    panel.querySelector('[data-cancel]').onclick=async()=>{await rpc({type:'ADVICE_COLLECT_CANCEL',requestId});panel.querySelector('[data-status]').textContent='已取消';panel.querySelector('[data-start]').disabled=false;panel.querySelector('[data-cancel]').disabled=true;requestId=null;};
    panel.querySelector('[data-clear]').onclick=async()=>{if(requestId)await rpc({type:'ADVICE_COLLECT_CANCEL',requestId});requestId=null;await rpc({type:'ADVICE_CLEAR'});panel.querySelector('[data-results]').replaceChildren();panel.querySelector('[data-start]').disabled=false;panel.querySelector('[data-cancel]').disabled=true;panel.querySelector('[data-status]').textContent='建议已清除；平台上的答案未改变。';};
    rpc({type:'ADVICE_GET'}).then(result=>{if(result && currentExercise===key && requestId===null){renderResults(result);panel.querySelector('[data-status]').textContent=`上次分析 ${new Date(result.at).toLocaleString()}，共 ${result.answers.length} 题；题面变化后请重新收集。`;}}).catch(e=>showError(e.message));
  }
  function showError(message) {if(!panel)return;panel.querySelector('[data-error]').textContent=message;panel.querySelector('[data-start]').disabled=false;panel.querySelector('[data-cancel]').disabled=true;}
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
    if(sender.id!==chrome.runtime.id)return;
    if(msg.type==='COLLECT_ADVICE' && all('.problem-body').some(visible)){reply?.({accepted:true});collect(msg.requestId);}
    if(msg.type==='CANCEL_ADVICE') {reply?.({accepted:true});if(collection){collection.cancelled=true;rpc({type:'ADVICE_CANCEL'}).catch(()=>{});}return;}
    if(msg.type==='ADVICE_UI' && isTop) {
      reply?.({accepted:true});
      if(!panel || msg.exercise!==currentExercise)return;
      if(msg.current){current=msg.current;highlight();}
      if(msg.requestId!==requestId)return;
      if(msg.message)panel.querySelector('[data-status]').textContent=msg.message;
      if(msg.error)showError(msg.error);
      if(msg.result)renderResults(msg.result);
    }
  });
  function update() {
    if(typeof location==='undefined'||typeof document==='undefined')return;
    ensurePanel();
    const order=activeOrder();
    if(order && order!==lastOrder){lastOrder=order;rpc({type:'ADVICE_PROGRESS',state:{current:order}}).catch(()=>{});}
  }
  const observer=new MutationObserver(update);
  observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  window.addEventListener('pagehide',()=>{observer.disconnect();if(collection){collection.cancelled=true;rpc({type:'ADVICE_CANCEL'}).catch(()=>{});}});
  update();
})();
