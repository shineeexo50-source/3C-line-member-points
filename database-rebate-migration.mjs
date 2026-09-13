import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {restoreSQL,wrapBackup,readBackup} from '../public/backup.js';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',mid='11111111-1111-4111-8111-111111111111';
const migration=readFileSync('sql/08_upgrade_reward_10pct.sql','utf8');
async function setup(db,old=false){
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);');
 let schema=readFileSync('sql/01_setup.sql','utf8');
 if(old)schema=schema.replace('reward_per_100 integer not null default 10 check(reward_per_100 in (5,10)), ','').replace('/100)*reward_per_100','/100)*5');
 await db.exec(schema);for(const n of ['04_upgrade_v2.sql','06_upgrade_v3.sql'])await db.exec(readFileSync('sql/'+n,'utf8'));
 await db.query('insert into auth.users values ($1,$2)',[actor,'admin@example.com']);
}
const db=new PGlite();await setup(db,true);await db.query('insert into admins values ($1)',[actor]);await db.query("insert into members(id,line_id,display_name) values ($1,'MIGRATE','會員')",[mid]);
const rpc=async(name,args)=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) d`,args)).rows[0].d;
const sale=(gross,redeemed=0)=>({id:crypto.randomUUID(),member_id:mid,gross,redeemed,items:[{name:'配件',qty:1,price:gross}],occurred_at:new Date().toISOString()});
const old=sale(1000);await rpc('admin_write_v2',[actor,'sale',old]);
const before=await rpc('admin_operations_v3',[actor,'backup',{}]);
await db.exec(migration);await db.exec(migration);
let row=(await db.query('select earned,reward_per_100 from transactions where id=$1',[old.id])).rows[0];assert.deepEqual(row,{earned:50,reward_per_100:5});
assert.equal((await rpc('admin_write_v2',[actor,'sale',old])).earned,50);
for(const [gross,earned] of [[99,0],[100,10],[150,10],[199,10],[200,20]])assert.equal((await rpc('admin_write_v2',[actor,'sale',sale(gross)])).earned,earned);
const newer=sale(500,50);assert.equal((await rpc('admin_write_v2',[actor,'sale',newer])).earned,40);
const batch=[{...sale(300),external_id:'IMPORT-NEW'}];let count=(await db.query('select count(*) n from transactions')).rows[0].n;
await rpc('admin_import_v2',[actor,batch,true]);assert.equal((await db.query('select count(*) n from transactions')).rows[0].n,count);
await rpc('admin_import_v2',[actor,batch,false]);assert.equal((await db.query("select earned from transactions where external_id='IMPORT-NEW'")).rows[0].earned,30);
await rpc('admin_write_v2',[actor,'void',{id:newer.id,member_id:mid,reason:'退貨'}]);
assert.equal((await rpc('admin_operations_v3',[actor,'reconcile',{}])).difference_count,0);
const backup=await rpc('admin_operations_v3',[actor,'backup',{}]);await readBackup(JSON.stringify(await wrapBackup(backup)));
for(const data of [before,backup]){const recovery=new PGlite();await setup(recovery);await recovery.exec(migration);await recovery.exec(restoreSQL(data,false));assert.equal(Number((await recovery.query('select coalesce(sum(earned-redeemed),0) n from transactions where voided_at is null')).rows[0].n),data.points);await recovery.close();}
await db.close();console.log('PASS: 5% history preserved, repeat migration, 10% boundaries, redemption, CSV dry run/import, void reconciliation, legacy/mixed backup restore');
