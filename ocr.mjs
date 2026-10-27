import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export async function recognizeQuestion(q, rendered) {
  if (!Array.isArray(rendered) || rendered.length!==q.options.length+1 || rendered.some(s=>typeof s!=='string' || s.length>2000000 || !/^[A-Za-z0-9+/]+=*$/.test(s))) throw Error('题目识别图片格式无效');
  const texts=await new Promise((resolve,reject)=>{
    const child=execFile(fileURLToPath(new URL('./.tools/ykt-ocr',import.meta.url)),[],{timeout:20000,maxBuffer:200000},(error,stdout)=>{
      if(error) return reject(Error(error.code==='ENOENT'?'本机题目识别不可用，请运行 npm run build:ocr 后重试':'本机题目识别失败或超时，请检查字体加载和题目画面'));
      try {resolve(JSON.parse(stdout));} catch {reject(Error('题目识别结果格式无效'));}
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify(rendered));
  });
  if(!Array.isArray(texts) || texts.length!==rendered.length || texts.some(s=>typeof s!=='string'||!s.trim())) throw Error('题目识别结果不完整');
  return {...q,stem:texts[0],options:q.options.map((o,i)=>({...o,text:texts[i+1]}))};
}
