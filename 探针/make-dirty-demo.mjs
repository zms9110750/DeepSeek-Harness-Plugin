import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const M = 0xfd2fb528, C = zlib.constants.ZSTD_c_checksumFlag;
const OPTS = typeof C === 'number' ? { params: { [C]: 1 } } : undefined;
const src = 'C:/Users/16229/.dsh/session-log-backups/--X-temp-dsh---20261019035354.zstd.bak';
const id = 'session-dirty-demo';
const dir = `C:/Users/16229/.dsh/sessions/--X-temp-dsh--/${id}`;
fs.mkdirSync(dir, { recursive: true });
function frames(buf){const out=[];let p=0;while(p<buf.length){const d=buf[p+4];const fcs=d>>6,s=(d>>5)&1,c=(d>>2)&1,di=d&3;let q=p+5+(s?0:1)+[0,1,2,4][di]+(fcs===0?(s?1:0):[0,2,4,8][fcs]);for(;;){const h=buf[q]|(buf[q+1]<<8)|(buf[q+2]<<16);q+=3+(((h>>1)&3)===1?1:(h>>3));if(h&1)break}if(c)q+=4;out.push([p,q]);p=q}return out}
const raw = fs.readFileSync(src);
const texts = frames(raw).map(([s,e]) => zlib.zstdDecompressSync(raw.subarray(s,e)).toString('utf8'));
const lines = texts.join('').split('\n'); lines.pop();
const header = JSON.parse(lines[0]); header.id = id;
const out = [zlib.zstdCompressSync(Buffer.from(JSON.stringify(header)+'\n','utf8'), OPTS),
  ...lines.slice(1).map(l => zlib.zstdCompressSync(Buffer.from(l+'\n','utf8'), OPTS))];
fs.writeFileSync(path.join(dir,'session.v4.jsonl.zstd'), Buffer.concat(out));
const wsPath = 'C:/Users/16229/.dsh/storages/workspace.json';
fs.copyFileSync(wsPath, wsPath + '.bak-forkdemo');
const ws = JSON.parse(fs.readFileSync(wsPath,'utf8'));
for (const w of Object.values(ws.tables.workspaces)) if (!w.sessionIds.includes(id)) w.sessionIds.unshift(id);
fs.writeFileSync(wsPath, JSON.stringify(ws, null, 2));
console.log(JSON.stringify({ id, events: lines.length-1, indexed: true }));