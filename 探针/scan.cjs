const fs=require('fs'),z=require('zlib'),path=require('path');
const root='C:/Users/16229/.dsh/sessions';
function read(f){
  const buf=fs.readFileSync(f); const starts=[];
  for(let i=0;i<buf.length-3;i++){ if(buf[i]===0x28&&buf[i+1]===0xB5&&buf[i+2]===0x2F&&buf[i+3]===0xFD) starts.push(i); }
  let text='';
  for(let k=0;k<starts.length;k++){ const seg=buf.subarray(starts[k], k+1<starts.length?starts[k+1]:buf.length); try{ text+=z.zstdDecompressSync(seg).toString('utf8'); }catch(e){} }
  return text.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
}
const found=[];
function walk(d){ for(const e of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,e.name); if(e.isDirectory()) walk(p); else if(e.name.endsWith('.zstd')){ try{ const ev=read(p); const bad=ev.filter(x=>x.type==='system/message' && (typeof x.data?.turn!=='number')); if(bad.length) found.push({file:p, total:ev.length, bad:bad.length, seq:bad[0].seq, keys:Object.keys(bad[0].data||{})}); }catch(err){} } } }
walk(root);
console.log(JSON.stringify(found,null,1));
