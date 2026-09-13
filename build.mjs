import {cpSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
const p=JSON.parse(readFileSync('package.json'));
const names=readdirSync('public').sort();
const hash=createHash('sha256');for(const n of names)hash.update(n).update(readFileSync('public/'+n));
const revision=hash.digest('hex').slice(0,12);
rmSync('dist',{recursive:true,force:true});mkdirSync('dist');cpSync('public','dist',{recursive:true});
for(const n of names){if(!/\.(html|js)$/.test(n))continue;let s=readFileSync('dist/'+n,'utf8');
s=s.replace(/(["'])(\.?\.?\/[^"'\s?]+\.(?:js|css))(?:\?v=[^"']*)?\1/g,(_,q,path)=>q+path+'?v='+revision+q);writeFileSync('dist/'+n,s);}
writeFileSync('dist/config.json',JSON.stringify({version:p.version,revision,builtAt:new Date().toISOString(),commit:(process.env.VERCEL_GIT_COMMIT_SHA||'').slice(0,8),liffId:(process.env.LIFF_ID||'').trim(),store:process.env.STORE_NAME||'鼓山3C手機配件',business:process.env.BUSINESS_NAME||'',contact:process.env.SUPPORT_CONTACT||''}));
console.log(`Built ${p.name} ${p.version} (${revision}); public config contains no credentials.`);
