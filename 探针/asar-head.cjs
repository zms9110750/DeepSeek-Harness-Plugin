const fs = require('fs');
const p = 'B:\\DeepSeek Harness\\resources\\app.asar';
// asar header: 8-byte pickle + JSON directory
const fd = fs.openSync(p, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const jsonSize = head.readUInt32LE(12);
const buf = Buffer.alloc(jsonSize);
fs.readSync(fd, buf, 0, jsonSize, 16);
const header = JSON.parse(buf.toString('utf8'));
console.log('entries:', Object.keys(header.files).length);
console.log('top:', Object.keys(header.files).slice(0, 12));
