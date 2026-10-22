const fs=require('fs'),z=require('zlib'),path=require('path');
const d='C:/Users/16229/.dsh/sessions/--X-temp-dsh--/session-f0603753-4d27-451a-b033-4dcaed64bb48';
const f=fs.readdirSync(d).find(n=>n.endsWith('.zstd'));
const raw=z.zstdDecompressSync(fs.readFileSync(path.join(d,f))).toString('utf8');
const lines=raw.split('\n').filter(Boolean);
console.log('file',f,'events',lines.length);
const types={};
for(const l of lines){try{const e=JSON.parse(l);types[e.type]=(types[e.type]||0)+1}catch{}}
console.log(JSON.stringify(types));
for(const l of lines.slice(-3)){console.log('---', l.slice(0,300));}
