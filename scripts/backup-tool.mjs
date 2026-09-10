// Offline recovery helper. No network, no database write, no credentials needed.
import {readFileSync,writeFileSync} from 'node:fs';
import {readBackup,validatePayload,restoreSQL} from '../public/backup.js';
const [mode,input,output]=process.argv.slice(2);
try{
 if(!['verify','drill','restore'].includes(mode)||!input)throw Error('用法：node scripts/backup-tool.mjs verify 備份.json 或 drill/restore 備份.json 輸出.sql');
 const payload=await readBackup(readFileSync(input,'utf8'));console.log(JSON.stringify(validatePayload(payload)));
 if(mode!=='verify'){if(!output)throw Error('請指定輸出 SQL 檔名');writeFileSync(output,restoreSQL(payload,mode==='drill'),{flag:'wx',mode:0o600});console.log('SQL 已產生，尚未執行。');}
}catch(e){console.error(e.message);process.exitCode=1;}
