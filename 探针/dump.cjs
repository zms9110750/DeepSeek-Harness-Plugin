const fs=require('fs'),z=require('zlib');
const f='C:/Users/16229/.dsh/sessions/--X-temp-dsh--/session-f1f9be57-a273-480f-97f6-454c95063c8a/session.v4.jsonl.zstd';
const buf=fs.readFileSync(f); const starts=[];
for(let i=0;i<buf.length-3;i++){ if(buf[i]===0x28&&buf[i+1]===0xB5&&buf[i+2]===0x2F&&buf[i+3]===0xFD) starts.push(i); }
let text='';
for(let k=0;k<starts.length;k++){ const seg=buf.subarray(starts[k], k+1<starts.length?starts[k+1]:buf.length); try{ text+=z.zstdDecompressSync(seg).toString('utf8'); }catch(e){} }
const arr=text.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
console.log('events',arr.length);
const sys=arr.filter(e=>e.type==='system/message');
for(const s of sys){ console.log('seq',s.seq,'keys',Object.keys(s.data||{}).join(','),'turn',s.data?.turn,'len',JSON.stringify(s.data?.message?.content||'').length); }
const head=arr[0]; console.log('header', JSON.stringify({id:head.id,parentSession:head.parentSession,origin:head.origin,isSeeded:head.isSeeded}));
const tail=arr.slice(-3).map(e=>e.type+':'+e.seq); console.log('tail',tail.join(' '));
