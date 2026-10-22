const fs=require('fs'),z=require('zlib');
const f='C:/Users/16229/.dsh/sessions/--X-temp-dsh--/session-0e669cba-6125-45e6-8d54-f1e602090a5c/session.v4.jsonl.zstd';
function read(){
  const buf=fs.readFileSync(f); const starts=[];
  for(let i=0;i<buf.length-3;i++){ if(buf[i]===0x28&&buf[i+1]===0xB5&&buf[i+2]===0x2F&&buf[i+3]===0xFD) starts.push(i); }
  let text='';
  for(let k=0;k<starts.length;k++){ const seg=buf.subarray(starts[k], k+1<starts.length?starts[k+1]:buf.length); try{ text+=z.zstdDecompressSync(seg).toString('utf8'); }catch(e){} }
  return text.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
}
(async()=>{
  for(let i=0;i<18;i++){
    let arr; try{ arr=read(); }catch(e){ console.log('read err', e.message); await new Promise(r=>setTimeout(r,8000)); continue; }
    const hit=arr.find(e=>JSON.stringify(e).includes('node n3 finished'));
    if(hit){ console.log('FOUND type='+hit.type, 'seq='+hit.seq); console.log(JSON.stringify(hit).slice(0,500)); return; }
    await new Promise(r=>setTimeout(r,8000));
  }
  console.log('not found after 144s');
})();
