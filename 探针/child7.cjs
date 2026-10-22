const fs=require('fs'),z=require('zlib');
const d='C:/Users/16229/.dsh/sessions/--X-temp-dsh--/session-70d9d1c0-a21e-442c-8641-e973cead6ec9/session.v4.jsonl.zstd';
if(!fs.existsSync(d)){ console.log('no child file yet'); process.exit(0); }
const buf=fs.readFileSync(d); const starts=[];
for(let i=0;i<buf.length-3;i++){ if(buf[i]===0x28&&buf[i+1]===0xB5&&buf[i+2]===0x2F&&buf[i+3]===0xFD) starts.push(i); }
let t=''; for(let k=0;k<starts.length;k++){ const seg=buf.subarray(starts[k], k+1<starts.length?starts[k+1]:buf.length); try{ t+=z.zstdDecompressSync(seg).toString('utf8'); }catch(e){} }
const a=t.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
const recs=a.filter(e=>e.ignorable===true && String(e.type).includes('plan-tree'));
console.log('events',a.length,'plan-tree records',recs.length);
for(const r of recs.slice(-4)) console.log(r.seq, r.data?.op, r.data?.id, r.data?.verdict||'');
