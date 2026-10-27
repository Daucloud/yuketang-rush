// Runs in the page world so a managed directory click can reuse its own tab.
(() => {
  const originalOpen=window.open;
  let armed=null;
  window.addEventListener('message',event=>{
    if(event.source!==window || event.origin!==location.origin || event.data?.type!=='YKT_ARM_OPEN') return;
    const token=event.data.token;
    if(typeof token!=='string' || token.length>100) return;
    armed={token,expires:Date.now()+60000};
    window.postMessage({type:'YKT_OPEN_READY',token},location.origin);
  });
  window.open=function(url,...args) {
    let target;
    try {target=new URL(String(url),location.href);} catch {}
    if(armed && Date.now()<armed.expires) {
      const token=armed.token;armed=null;
      window.postMessage({type:'YKT_OPEN_CAPTURED',token,url:target?.href||''},location.origin);
      return null;
    }
    return originalOpen.call(this,url,...args);
  };
})();
