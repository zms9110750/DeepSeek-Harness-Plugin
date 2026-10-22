const fs=require('fs'),z=require('zlib');
const d='C:/Users/16229/.dsh/sessions/--X-temp-dsh--/session-9e083a9d-b0a3-4d2f-ad0f-e6502a9a5bd1/session.v4.jsonl.zstd';
if(!fs.existsSync(d)){ console.log('no child session file'); process.exit(0); }
const buf=fs.readFileSync(d); const starts=[];
for(let i=0;i<buf.length-3;i++){ if(buf[i]===0x28&&buf[i+1]===0xB5&&buf[i+2]===0x2F&&buf[i+3]===0xFD) starts.push(i); }
let text='';
for(let k=0;k<starts.length;k++){ const seg=buf.subarray(starts[k], k+1<starts.length?starts[k+1]:buf.length); try{ text+=z.zstdDecompressSync(seg).toString('utf8'); }catch(e){} }
const arr=text.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
console.log('events',arr.length,'mtime',fs.statSync(d).mtime.toISOString());
const plan=arr.filter(e=>e.type==='plan-tree/dispatch').map(e=>e.data.id);
console.log('dispatch nodes in child', JSON.stringify(plan));
const users=arr.filter(e=>e.type==='user/message');
const lastUser=users[users.length-1];
console.log('last user msg:', JSON.stringify(lastUser?.data?.message?.content ?? '').slice(0,200));
const asst=arr.filter(e=>e.type==='assistant/message');
console.log('assistant msgs', asst.length, 'last seq', asst[asst.length-1]?.seq);
const c=asst[asst.length-1]?.data?.message?.content ?? [];
console.log('last text:', JSON.stringify(c.filter(b=>b.type==='text').map(b=>b.text).join('')).slice(0,300));
