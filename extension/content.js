(() => {
  if (globalThis.__yktTileAssistant) return;
  globalThis.__yktTileAssistant = true;
  document.documentElement.dataset.yktAssistantVersion=chrome.runtime.getManifest?.().version || 'development';
  const topFrame = window === window.top;
  const text = el => (el?.innerText || el?.textContent || '').replace(/\s+/g,' ').trim();
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const all = (selector, root=document) => [...root.querySelectorAll(selector)];
  const delay = ms => new Promise(r=>setTimeout(r,ms));
  async function startPlayback(v) {
    let timer;
    try {
      await Promise.race([v.play(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('播放器启动超过 10 秒，请检查网络后重试')),10000);})]);
    } finally { clearTimeout(timer); }
  }
  async function armOpen(target=window) {
    const token=`${Date.now()}-${Math.random()}`;
    await new Promise((resolve,reject)=>{
      const ready=event=>{
        if(event.source!==target || event.origin!==location.origin || event.data?.type!=='YKT_OPEN_READY' || event.data.token!==token) return;
        clearTimeout(timer);window.removeEventListener('message',ready);resolve();
      };
      const timer=setTimeout(()=>{window.removeEventListener('message',ready);reject(Error('无法启用无弹窗开课，请更新扩展并刷新目录页'));},1500);
      window.addEventListener('message',ready);
      target.postMessage({type:'YKT_ARM_OPEN',token},location.origin);
    });
    const taskId=context.task.id, epoch=context.epoch;
    const capture=event=>{
      if(event.source!==target || event.origin!==location.origin || event.data?.type!=='YKT_OPEN_CAPTURED' || event.data.token!==token) return;
      clearTimeout(timer);window.removeEventListener('message',capture);
      rpc({type:'OPEN_UNIT',taskId,epoch,url:event.data.url}).catch(error=>status(error.message,'attention'));
    };
    const timer=setTimeout(()=>window.removeEventListener('message',capture),60000);
    window.addEventListener('message',capture);
  }
  async function rpc(msg) { const r=await chrome.runtime.sendMessage(msg); if(!r?.ok) throw Error(r?.error||'扩展连接中断'); return r.value; }
  function click(el) {
    el.scrollIntoView({block:'nearest'});
    el.click();
  }
  function chooseSpeed(option) {
    // Some XT player versions select on mouse down. Use the advertised
    // menu and normal mouse event sequence; never write playbackRate directly.
    const menu=option.closest('xt-speedbutton');
    for(const type of ['mouseover','mouseenter']) menu?.dispatchEvent(new MouseEvent(type,{bubbles:type==='mouseover',view:window}));
    option.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,view:window,button:0,buttons:1}));
    option.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,view:window,button:0,buttons:0}));
    option.click();
  }
  let badge;
  function show(note) {
    if(!topFrame) return;
    if(!badge) {
      badge=document.createElement('div'); badge.id='ykt-tile-status';
      Object.assign(badge.style,{position:'fixed',left:'12px',bottom:'12px',zIndex:'2147483647',maxWidth:'420px',padding:'9px 13px',background:'#172a38',color:'white',borderRadius:'9px',font:'12px/1.6 system-ui',pointerEvents:'none'});
      document.documentElement.append(badge);
    }
    badge.textContent=`平铺助手 · ${note}`;
  }
  async function expand(root=document) {
    for(const chapter of all('.chapter-list',root)) {
      const header=chapter.querySelector('.header .pointer'),content=chapter.querySelector('.content');
      if(visible(header) && content && !visible(content)) {click(header);await delay(200);}
    }
    for(let round=0;round<12;round++) {
      const nodes=all('span,button,a,div',root).filter(el=>visible(el) && text(el)==='展开' && ![...el.children].some(c=>text(c)==='展开'));
      if(!nodes.length) break;
      click(nodes[0]); await delay(200);
    }
  }
  // Only the top script coordinates same-origin legacy directories. Task URLs
  // always remain the outer course URL, including when a child opens the video.
  function directoryRoots() {
    const roots=[document];
    if(topFrame) for(const frame of all('iframe[src]')) {
      try {
        const url=new URL(frame.src,location.href);
        if(visible(frame) && url.origin===location.origin && url.pathname.startsWith('/pro/lms/') && frame.contentDocument) roots.push(frame.contentDocument);
      } catch { /* Cross-origin frames are not course directories. */ }
    }
    return roots;
  }
  async function prepareDirectory() {
    if(topFrame && /\/v2\/web\/studentLog\//.test(location.pathname) && !rows().length && !all('iframe[src*="/pro/lms/"]').some(visible)) {
      const tab=all('span,button,a,div').find(el=>visible(el) && text(el)==='学习内容' && ![...el.children].some(c=>text(c)==='学习内容'));
      if(tab) {click(tab);await delay(200);}
    }
    for(const root of directoryRoots()) await expand(root);
  }
  function rowsIn(root) {
    const leaves=all('.leaf-item',root).filter(visible).flatMap(row=>{
      const heading=row.querySelector('.leaf-item-title'),title=text(heading),kind=text(row.querySelector('.leaf-item-tag'));
      if(!title || !['视频','作业'].includes(kind)) return [];
      return [{title,row,heading:row,kind:kind==='视频'?'video':'homework',completed:!!row.querySelector('[class*=yuanquangou]'),status:text(row)}];
    });
    if(leaves.length) return leaves;
    const legacy=all('.leaf-detail',root).filter(visible).flatMap(row=>{
      const title=text(row.querySelector('.leaf-title .title'));
      const kind=row.querySelector('.icon--shipin')?'video':row.querySelector('.icon--zuoye')?'homework':null;
      if(!title || !kind) return [];
      const progress=text(row.querySelector('.progress-time'));
      return [{title,row,heading:row,kind,completed:/已完成|(?:^|\s)100\s*%/.test(progress),status:progress}];
    });
    if(legacy.length) return legacy;
    return all('h2',root).filter(visible).flatMap(h=>{
      const title=text(h); if(!title) return [];
      let row=h.parentElement;
      for(let i=0;row && i<5;i++,row=row.parentElement) {
        const s=text(row);
        if(row.querySelectorAll('h2').length!==1) break;
        if(/考核截止时间/.test(s) && /已完成|未开始|进行中|\d+\s*%|待批改/.test(s)) return [{title, row, heading:h, completed:s.includes('已完成'),kind:/作业|测试/.test(s)?'homework':'video', status:s}];
      }
      return [];
    });
  }
  function rows() {return directoryRoots().flatMap(rowsIn);}
  async function scan() {
    if(!topFrame) return [];
    await prepareDirectory();
    // Legacy iframe contents may still be loading after selecting 学习内容.
    for(let retry=0;!rows().length && retry<20;retry++) {await delay(200);await prepareDirectory();}
    const found=rows(), seen=new Set();
    return found.map(r=>{
      if(seen.has(r.title)) throw Error(`目录有同名学习单元「${r.title}」，请改用各单元独立链接`);
      seen.add(r.title);
      return {url:location.href,targetTitle:r.title,title:r.title,kind:r.kind,completed:r.completed};
    });
  }
  let context=null, busy=false, ownedVideo=null, previous=null, lastAdvance=Date.now(), endedAt=0, requestedPlayAt=0, taskKey='', openingAt=0;
  let rateAttemptAt=0, openClicked=false, activeEpoch='', wasHidden=false;
  async function status(note,event,media) {
    if(event==='attention') await pauseOwned();
    show(note);
    if(context) await rpc({type:'STATUS',taskId:context.task.id,epoch:context.epoch,note,event,media});
  }
  async function pauseOwned() {
    if(ownedVideo && !ownedVideo.paused) ownedVideo.pause();
    if(context) for(const v of all('video').filter(visible)) if(!v.paused) v.pause();
  }
  async function tick() {
    if(busy) return; busy=true;
    try {
      const next=await rpc({type:'HELLO'});
      if(!next.active) { if(context) {await pauseOwned(); show(next.task?.phase==='attention'?next.task.note:'已暂停或此窗口的任务已结束');} context=null; return; }
      context=next;
      const k=context.task.id;
      if(k!==taskKey) { taskKey=k; previous=null; endedAt=0; openingAt=Date.now(); lastAdvance=Date.now(); openClicked=false; }
      if(activeEpoch!==context.epoch) { activeEpoch=context.epoch; previous=null; lastAdvance=Date.now(); }
      if(/作答安全核验|请完成安全核验/.test(text(document.body))) {
        await status('页面要求安全核验，请完成核验后检查当前题目再重试','attention');return;
      }
      const {task,config}=context;
      if(task.phase==='opening' || task.phase==='verifying') {
        if(!topFrame) return;
        if(task.phase==='opening' && location.href!==task.url && (all('video,.problem-body,#iframeExerciseId').length || /\/cloud\/student\//.test(location.pathname))) { await status('学习单元已打开','opened'); return; }
        await prepareDirectory();
        const matches=rows().filter(r=>r.title===task.targetTitle);
        if(matches.length!==1) {
          if(Date.now()-openingAt>45000) await status('无法唯一定位学习单元；请检查登录和目录','attention');
          else await status('等待课程目录加载');
          return;
        }
        if(task.phase==='verifying') {
          await pauseOwned();
          if(matches[0].completed) await status('课程目录显示已完成','verified');
          else if(Date.now()-(task.changedAt||openingAt)>35000) await status('目录尚未显示已完成，请检查学习记录','attention');
          else await status('视频已结束，等待目录确认完成');
          return;
        }
        if(matches[0].row.classList.contains('is-active') && all('video,#iframeExerciseId').length) {
          await status('学习单元已打开','opened');return;
        }
        if(!openClicked) {
          await armOpen(matches[0].heading.ownerDocument.defaultView);
          const fresh=await rpc({type:'HELLO'});
          if(!fresh.active || fresh.epoch!==context.epoch || fresh.task.id!==task.id) return;
          openClicked=true; click(matches[0].heading); await delay(500);
        }
        if(location.href!==task.url) await status('学习单元已打开','opened');
        else if(Date.now()-openingAt>45000) await status('点击后未进入单元；请允许雨课堂站点弹窗后重试，或改用单元独立链接','attention');
        return;
      }
      if(all('.problem-body,#iframeExerciseId,.lms-graph-exercise').some(visible)) {
        await pauseOwned(); await status('作业改为手动作答，请在侧边查看批量答案建议','manual'); return;
      }
      const videos=all('video').filter(visible);
      if(!videos.length) { if(topFrame) await status('等待播放器；若长期不出现，请检查登录或页面适配'); return; }
      if(videos.length!==1) { await status('页面有多个播放器，无法确定课程主视频','attention'); return; }
      const v=videos[0]; ownedVideo=v; v.muted=true;
      if(previous===null || previous.video!==v || v.currentTime>previous.time+.1 || (wasHidden && document.visibilityState==='visible')) lastAdvance=Date.now();
      previous={video:v,time:v.currentTime};
      wasHidden=document.visibilityState!=='visible';
      const media={time:Math.round(v.currentTime*10)/10,duration:Number.isFinite(v.duration)?Math.round(v.duration):null,rate:v.playbackRate,visible:document.visibilityState==='visible',focused:document.hasFocus(),paused:v.paused,ended:v.ended,stalledFor:Math.floor((Date.now()-lastAdvance)/1000)};
      if(v.error) { await status(`播放器错误 ${v.error.code}，请检查网络`,'attention',media); return; }
      if(v.ended) { endedAt ||= Date.now(); if(Date.now()-endedAt>10000) await status('视频结束，等待目录确认','ended',media); else await status('视频结束，等待学习记录更新',null,media); return; }
      endedAt=0;
      // Select only a speed advertised by the player's actual menu.
      if(v.playbackRate!==config.rate && Date.now()-rateAttemptAt>15000) {
        rateAttemptAt=Date.now();
        const option=all('xt-speedbutton li[data-speed]').find(el=>Number(el.dataset.speed)===config.rate);
        if(option) chooseSpeed(option);
      }
      if(v.paused && Date.now()-requestedPlayAt>15000) {
        requestedPlayAt=Date.now(); v.muted=true;
        try { await startPlayback(v); } catch(error) {
          const fresh=await rpc({type:'HELLO'});
          if(!fresh.active || fresh.epoch!==context.epoch || fresh.task.id!==task.id) return;
          if(error.name==='AbortError') {
            media.paused=v.paused;
            if(Date.now()-lastAdvance>45000) await status('播放器持续暂停，45 秒无进度；请检查课程窗口可见性、弹窗或网络','attention',media);
            else await status('播放器中断了启动请求，将稍后重试；请保持课程窗口可见',null,media);
            return;
          }
          v.pause();await status(error.name==='NotAllowedError'?'浏览器阻止自动播放，请在这个窗口点一次播放':error.message,'attention',media);return;
        }
        const fresh=await rpc({type:'HELLO'});
        if(!fresh.active || fresh.epoch!==context.epoch || fresh.task.id!==context.task.id) { v.pause(); return; }
      }
      if(Date.now()-lastAdvance>45000) { await status('播放进度 45 秒未增长，请检查遮挡、题目弹窗或网络','attention',media); return; }
      media.paused=v.paused; media.rate=v.playbackRate;
      await status(`${media.visible?'':'页面隐藏，平台计时待确认 · '}播放中 ${media.time}s / ${media.duration ?? '?'}s · 实际 ${v.playbackRate}×${v.playbackRate!==config.rate?'（目标倍速未生效）':''} · ${media.focused?'有焦点':'无焦点'}`,null,media);
    } catch(error) {
      if(context) { try { await status(error.message,'attention'); } catch {show('扩展连接断开，请刷新页面');} }
    } finally {busy=false;}
  }
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
    if(sender.id!==chrome.runtime.id) return;
    if(msg.type==='SCAN' && topFrame) {scan().then(value=>reply({ok:true,value})).catch(e=>reply({ok:false,error:e.message})); return true;}
    if(msg.type==='REFRESH') { pauseOwned(); tick(); reply({ok:true}); }
  });
  setInterval(tick,3000); tick();
})();
