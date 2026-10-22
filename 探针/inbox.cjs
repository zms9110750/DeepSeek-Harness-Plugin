const fs=require('fs'),z=require('zlib');
const f='C:/Users/16229/.dsh/sessions/--X-temp-dsh--/session-0e669cba-6125-45e6-8d54-f1e602090a5c/session.v4.jsonl.zstd';
const buf=fs.readFileSync(f); const starts=[];
for(let i=0;i<buf.length-3;i++){ if(buf[i]===0x28&&buf[i+1]===0xB5&&buf[i+2]===0x2F&&buf[i+3]===0xFD) starts.push(i); }
let t=''; for(let k=0;k<starts.length;k++){ const seg=buf.subarray(starts[k], k+1<starts.length?starts[k+1]:buf.length); try{ t+=z.zstdDecompressSync(seg).toString('utf8'); }catch(e){} }
const a=t.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
const inbox=a.filter(e=>String(e.type).startsWith('agent/inbox'));
console.log('inbox events', inbox.length);
const last=inbox.slice(-3);
for(const e of last){ console.log('--',e.type,'seq',e.seq, JSON.stringify(e.data).slice(0,400)); }
const hasOurs=JSON.stringify(inbox).includes('e738896d');
console.log('mentions our child:', hasOurs);
