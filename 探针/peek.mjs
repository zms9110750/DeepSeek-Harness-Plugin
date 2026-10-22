const fs=require('fs'),z=require('zlib');
const p='C:/Users/16229/.dsh/sessions/session-f0603753-4d27-451a-b033-4dcaed64bb48/session.v4.jsonl.zstd';
const raw=z.zstdDecompressSync(fs.readFileSync(p)).toString('utf8');
const lines=raw.split('\n').filter(Boolean);
console.log('events',lines.length);
const types={};
for(const l of lines){try{const e=JSON.parse(l);types[e.type]=(types[e.type]||0)+1}catch{}}
console.log(JSON.stringify(types,null,0));
const last=lines.slice(-3).map(l=>l.slice(0,220));
console.log(last.join('\n---\n'));
