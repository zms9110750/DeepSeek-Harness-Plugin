const fs=require('fs'),path=require('path');
const buf=fs.readFileSync('B:/DeepSeek Harness/resources/app.asar');
const headerSize=buf.readUInt32LE(4);
const jsonSize=buf.readUInt32LE(12);
const json=JSON.parse(buf.toString('utf8',16,16+jsonSize));
const base=8+headerSize;
function find(p){let n=json;for(const part of p.split('/').filter(Boolean)){n=n.files[part];if(!n)throw new Error('missing '+part+' in '+p);}return n;}
const targets=process.argv.slice(2);
for(const t of targets){const n=find(t);const b=Buffer.from(buf.subarray(base+Number(n.offset),base+Number(n.offset)+n.size));const o=path.join('X:/temp/dsh/探针/asar',t);fs.mkdirSync(path.dirname(o),{recursive:true});fs.writeFileSync(o,b);console.log(t,n.size);}
