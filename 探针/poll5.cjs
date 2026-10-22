const fs=require('fs'),z=require('zlib');
const f='C:/Users/16229/.dsh/sessions/--X-temp-dsh--/session-0e669cba-6125-45e6-8d54-f1e602090a5c/session.v4.jsonl.zstd';
function read(){ const buf=fs.readFileSync(f); const starts=[];
  for(let i=0;i<buf.length-3;i++){ if(buf[i]===0x28&&buf[i+1]===0xB5&&buf[i+2]===0x2F&&buf[i+3]===0xFD) starts.push(i); }
  let t=''; for(let k=0;k<starts.length;k++){ const seg=buf.subarray(starts[k], k+1<starts.length?starts[k+1]:buf.length); try{ t+=z.zstdDecompressSync(seg).toString('utf8'); }catch(e){} }
  return t.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean); }
(async()=>{ for(let i=0;i<18;i++){
  let a; try{ a=read(); }catch(e){ await new Promise(r=>setTimeout(r,8000)); continue; }
  const hit=a.filter(e=>(e.type==='user/message') && e.data?.source?.kind==='subagent-settled');
  console.log('tick',i,'events',a.length,'settled-source msgs',hit.length);
  if(hit.length){ const h=hit[hit.length-1]; console.log('seq',h.seq,'source',JSON.stringify(h.data.source).slice(0,200)); return; }
  await new Promise(r=>setTimeout(r,8000)); }
  console.log('none after 144s'); })();
