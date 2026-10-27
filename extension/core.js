export function courseURL(value) {
  const u = new URL(value);
  if (u.origin !== 'https://pro.yuketang.cn' || u.username || u.password) throw Error('只接受 pro.yuketang.cn 的 HTTPS 课程地址');
  return u.href;
}

// All coordinates are Chrome device-independent screen pixels, including negative origins.
export function tileRects(area, count) {
  if (!Number.isInteger(count) || count < 1 || count > 4) throw Error('并发窗口数量必须为 1–4');
  const candidates = [];
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const width = Math.floor(area.width / cols), height = Math.floor(area.height / rows);
    if (width >= 500 && height >= 360) candidates.push({ cols, width, height, score: Math.abs(width / height - 1.5) + (cols * rows - count) * .2 });
  }
  candidates.sort((a,b) => a.score - b.score);
  if (!candidates.length) throw Error('屏幕空间不足，请减少并发窗口或选择更大的显示器');
  const { cols, width, height } = candidates[0];
  return Array.from({ length: count }, (_,i) => ({ left: area.left + i % cols * width, top: area.top + Math.floor(i / cols) * height, width, height }));
}

export function validateQuestion(q) {
  if (!q || !['single','multiple'].includes(q.kind) || typeof q.stem !== 'string' || !q.stem.trim() || q.stem.length > 20000) throw Error('题干或题型无效');
  if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 20) throw Error('选项数量无效');
  const ids = new Set();
  for (const o of q.options) {
    if (!o || typeof o.id !== 'string' || !o.id || o.id.length > 30 || ids.has(o.id) || typeof o.text !== 'string' || !o.text.trim() || o.text.length > 10000) throw Error('选项缺失或重复');
    ids.add(o.id);
  }
  return { kind: q.kind, stem: q.stem, options: q.options.map(({id,text}) => ({id,text})) };
}

export function validateAnswer(answer, question) {
  validateQuestion(question);
  if (!answer || typeof answer.uncertain !== 'boolean' || typeof answer.explanation !== 'string' || !Array.isArray(answer.selected)) throw Error('模型输出格式无效');
  const ids = new Set(question.options.map(o => o.id));
  if (answer.selected.some(id => !ids.has(id)) || new Set(answer.selected).size !== answer.selected.length) throw Error('模型返回了不存在或重复的选项');
  if (!answer.uncertain && (answer.selected.length < 1 || (question.kind === 'single' && answer.selected.length !== 1))) throw Error('模型答案与题型不匹配');
  return { selected: answer.selected, uncertain: answer.uncertain, explanation: answer.explanation.slice(0,4000) };
}

export function fingerprint(q) { return JSON.stringify(validateQuestion(q)); }

export function validateBatch(input) {
  if (!Array.isArray(input?.questions) || !input.questions.length || input.questions.length>100) throw Error('批量题目数量必须为 1–100');
  const ids=new Set();
  return input.questions.map(item=>{
    if(typeof item?.id!=='string' || !item.id || item.id.length>60 || ids.has(item.id)) throw Error('批量题号缺失或重复');
    ids.add(item.id);
    return {id:item.id,...validateQuestion(item),...(item.rendered?{rendered:item.rendered}:{})};
  });
}

export function validateBatchAnswers(output,questions) {
  if(!Array.isArray(output?.answers) || output.answers.length!==questions.length) throw Error('模型未返回全部题目的答案');
  const byId=new Map();
  for(const a of output.answers) {
    if(!a || typeof a.id!=='string' || byId.has(a.id)) throw Error('模型返回题号重复或缺失');
    byId.set(a.id,a);
  }
  return {answers:questions.map(q=>{
    const a=byId.get(q.id),answer=validateAnswer(a,q);
    if(q.rendered && (typeof a.stem!=='string' || !a.stem.trim() || !Array.isArray(a.options))) throw Error('模型未完整转写题干和选项，请重新分析');
    const stem=typeof a.stem==='string' && a.stem.trim()?a.stem.slice(0,20000):q.stem;
    let options=q.options;
    if(a.options!==undefined) options=validateQuestion({...q,stem,options:a.options}).options;
    if(options.length!==q.options.length || options.some(o=>!q.options.some(p=>p.id===o.id))) throw Error('模型转写的选项与原题不匹配');
    return {id:q.id,kind:q.kind,stem,options:q.options.map(original=>options.find(o=>o.id===original.id)),...answer};
  })};
}
