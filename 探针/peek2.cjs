const fs=require('fs'),z=require('zlib');
const d='C:/Users/16229/.dsh/sessions/--X-temp-dsh--/session-f0603753-4d27-451a-b033-4dcaed64bb48/session.v4.jsonl.zstd';
const buf=fs.readFileSync(d);
const magic=Buffer.from([0x28,0xB5,0x2F,0xFD]);
const starts=[]; for(let i=0;i<buf.length-3;i++){ if(buf[i]===0x28&&buf[i+1]===0xB5&&buf[i+2]===0x2F&&buf[i+3]===0xFD) starts.push(i); }
let text='';
for(let k=0;k<starts.length;k++){
  const seg=buf.subarray(starts[k], k+1<starts.length?starts[k+1]:buf.length);
  try{ text+=z.zstdDecompressSync(seg).toString('utf8'); }catch(e){}
}
const lines=text.split('\n').filter(Boolean);
const types={};
for(const l of lines){try{const e=JSON.parse(l);types[e.type]=(types[e.type]||0)+1}catch{}}
console.log('frames',starts.length,'events',lines.length);
console.log(JSON.stringify(types));
const arr=lines.map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
const dispatch=arr.find(e=>e.type==='plan-tree/dispatch');
console.log('dispatch event:', JSON.stringify(dispatch).slice(0,200));
const asst=arr.filter(e=>e.type==='assistant/message');
console.log('assistant msgs:', asst.length);
if(asst.length) console.log(JSON.stringify(asst[asst.length-1].data).slice(0,600));
