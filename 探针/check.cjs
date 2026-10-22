const fs=require('fs'),z=require('zlib');
const f='C:/Users/16229/.dsh/sessions/--X-temp-dsh--/session-0e669cba-6125-45e6-8d54-f1e602090a5c/session.v4.jsonl.zstd';
const buf=fs.readFileSync(f); const starts=[];
for(let i=0;i<buf.length-3;i++){ if(buf[i]===0x28&&buf[i+1]===0xB5&&buf[i+2]===0x2F&&buf[i+3]===0xFD) starts.push(i); }
let t=''; for(let k=0;k<starts.length;k++){ const seg=buf.subarray(starts[k], k+1<starts.length?starts[k+1]:buf.length); try{ t+=z.zstdDecompressSync(seg).toString('utf8'); }catch(e){} }
const a=t.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
const rec=a.filter(e=>String(e.type).includes('plan-tree'));
console.log('plan-tree events', rec.length);
for(const e of rec.slice(-4)) console.log(e.seq, 'type='+e.type, 'ignorable='+e.ignorable, 'keys='+Object.keys(e).join(','));
const unknown=a.filter(e=>e.ignorable!==true && /^[a-z-]+\/[a-z-]+$/.test(String(e.type)) && !['turn/start','turn/end','step/start','step/end','tool/call','tool/result','user/message','system/message','assistant/message','assistant/attempt','developer/message','request/header','request/context','session/end-seed','agent/inbox/spliced','job/registered','job/settled','command/run','command/done','workspace/changes','session/title','llm/retry','llm/retry-started','compaction/start','compaction/summary','compaction/end','gate/set','todo/write','deliverables/presented','approval/asked','approval/decided','permission/preset','sandbox/mode','approval/policy','agent-preset/selected','subagent/catalog'].includes(String(e.type)));
console.log('non-ignorable unknown-looking types:', unknown.length);
if(unknown.length) console.log(unknown.slice(0,3).map(e=>e.seq+':'+e.type).join(' '));
