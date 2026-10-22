const fs=require('fs'),z=require('zlib');
function read(f){ const buf=fs.readFileSync(f); const starts=[];
  for(let i=0;i<buf.length-3;i++){ if(buf[i]===0x28&&buf[i+1]===0xB5&&buf[i+2]===0x2F&&buf[i+3]===0xFD) starts.push(i); }
  let text='';
  for(let k=0;k<starts.length;k++){ const seg=buf.subarray(starts[k], k+1<starts.length?starts[k+1]:buf.length); try{ text+=z.zstdDecompressSync(seg).toString('utf8'); }catch(e){} }
  return text.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean); }
for(const id of ['session-0e669cba-6125-45e6-8d54-f1e602090a5c','session-f1f9be57-a273-480f-97f6-454c95063c8a']){
  const f='C:/Users/16229/.dsh/sessions/--X-temp-dsh--/'+id+'/session.v4.jsonl.zstd';
  const a=read(f);
  // 头部事件 seq 可能从 0 开始；找出不连续处
  const gaps=[];
  for(let i=1;i<a.length;i++){ if(a[i].seq !== a[i-1].seq+1) gaps.push({at:i, prev:a[i-1].seq, cur:a[i].seq, type:a[i].type}); }
  console.log(id.slice(0,16),'events',a.length,'firstSeq',a[0].seq,'gaps',gaps.length);
  if(gaps.length) console.log(JSON.stringify(gaps.slice(0,5)));
}
