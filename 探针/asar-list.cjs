const fs=require('fs');
const buf=fs.readFileSync('B:/DeepSeek Harness/resources/app.asar');
const headerSize=buf.readUInt32LE(4);
const jsonSize=buf.readUInt32LE(12);
const json=JSON.parse(buf.toString('utf8',16,16+jsonSize));
const base=8+headerSize;
const out=[];
function walk(node,prefix){for(const [k,v] of Object.entries(node.files||{})){const p=prefix+'/'+k;if(v.files)walk(v,p);else out.push(p);}}
walk(json,'');
fs.writeFileSync('X:/temp/dsh/探针/asar-list.txt',out.join('\n'));
console.log('files',out.length);
console.log(out.filter(p=>/persistence|dsh-agent\//.test(p)).slice(0,40).join('\n'));
