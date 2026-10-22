const fs=require('fs'),z=require('zlib');
const f='C:/Users/16229/.dsh/sessions/--X-temp-dsh--/session-0e669cba-6125-45e6-8d54-f1e602090a5c/session.v4.jsonl.zstd';
function read(){
  const buf=fs.readFileSync(f); const starts=[];
  for(let i=0;i<buf.length-3;i++){ if(buf[i]===0x28&&buf[i+1]===0xB5&&buf[i+2]===0x2F&&buf[i+3]===0xFD) starts.push(i); }
  let text='';
  for(let k=0;k<starts.length;k++){ const seg=buf.subarray(starts[k], k+1<starts.length?starts[k+1]:buf.length); try{ text+=z.zstdDecompressSync(seg).toString('utf8'); }catch(e){} }
  return text.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
}
function textOf(e){ const c=e?.data?.message?.content; if(!Array.isArray(c)) return ''; return c.filter(b=>b.type==='text').map(b=>b.text).join('\n'); }
(async()=>{
  for(let i=0;i<20;i++){
    let arr; try{ arr=read(); }catch(e){ await new Promise(r=>setTimeout(r,8000)); continue; }
    const sys=arr.filter(e=>e.type==='system/message');
    const notices=arr.filter(e=>['system/message','user/message','developer/message'].includes(e.type) && textOf(e).includes('node n') && textOf(e).includes('finished'));
    console.log('tick',i,'events',arr.length,'system/message',sys.length,'notices',notices.length);
    if(notices.length){ for(const n of notices){ console.log('NOTICE type='+n.type+' seq='+n.seq); console.log(textOf(n).slice(0,300)); } return; }
    await new Promise(r=>setTimeout(r,8000));
  }
  console.log('no notice after 160s');
})();
