const fs=require('fs'),z=require('zlib');
function read(f){ const buf=fs.readFileSync(f); const starts=[];
  for(let i=0;i<buf.length-3;i++){ if(buf[i]===0x28&&buf[i+1]===0xB5&&buf[i+2]===0x2F&&buf[i+3]===0xFD) starts.push(i); }
  let text='';
  for(let k=0;k<starts.length;k++){ const seg=buf.subarray(starts[k], k+1<starts.length?starts[k+1]:buf.length); try{ text+=z.zstdDecompressSync(seg).toString('utf8'); }catch(e){} }
  return text.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean); }
for(const id of ['session-0e669cba-6125-45e6-8d54-f1e602090a5c','session-6e2497a9-d68d-439f-83d0-f91704009a09']){
  const f='C:/Users/16229/.dsh/sessions/--X-temp-dsh--/'+id+'/session.v4.jsonl.zstd';
  const a=read(f);
  let open=0;
  for(const e of a){ if(e.type==='turn/start') open++; if(e.type==='turn/end') open--; }
  const last=a[a.length-1];
  console.log(id.slice(0,20),'events',a.length,'openTurns',open,'last',last.type,last.seq, new Date(last.time).toISOString());
}
