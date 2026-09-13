import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import handler from '../api/app.js';
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',mid='11111111-1111-4111-8111-111111111111',oid='22222222-2222-4222-8222-222222222222',key='33333333-3333-4333-8333-333333333333';
Object.assign(process.env,{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',LINE_CHANNEL_ACCESS_TOKEN:'test-server-only-token'});
const response=(d,status=200,headers={})=>new Response(JSON.stringify(d),{status,headers});
async function call(body,token='valid'){let code=200,data;await handler({method:'POST',headers:{host:'example.vercel.app','x-member-app':'1',...(token?{authorization:'Bearer '+token}:{})},body},{setHeader(){},status(n){code=n;return this;},json(d){data=d;return this;}});return {code,data};}
function auth(url){if(String(url).endsWith('/auth/v1/user'))return response({id:actor});if(String(url).includes('/rest/v1/admins?'))return response([{user_id:actor}]);}
const body={action:'notify_order',data:{member_id:mid,id:oid,version:2,to:'attacker',message:'untrusted'}};
const job={id:key,line_id:'U11111111111111111111111111111111',message:'會員訂購進度通知',status:'pending'};
test('missing branding/contact elements never abort configuration load',async()=>{
 const originalFetch=global.fetch,doc=global.document;try{global.document={querySelector(){return null;}};global.fetch=async()=>response({store:'測試店',version:'4.0.0'});const source=readFileSync(new URL('../public/core.js',import.meta.url),'utf8');const core=await import('data:text/javascript,'+encodeURIComponent(source));assert.equal((await core.loadConfig()).store,'測試店');assert.doesNotThrow(()=>core.status(null,true));}finally{global.fetch=originalFetch;global.document=doc;}
});
test('orders require login; manual notification marking and forged fields cannot be used',async()=>{
 global.fetch=async(url,options)=>{const a=auth(url);if(a)return a;const p=JSON.parse(options.body);assert.equal(p.p_actor,actor);assert.equal(p.p_data.created_by,undefined);assert.equal(p.p_data.notified,undefined);return response({id:oid});};
 assert.equal((await call({action:'custom_orders',data:{op:'list',member_id:mid}},'')).code,401);
 assert.equal((await call({action:'custom_orders',data:{op:'notify_mark',member_id:mid,id:oid}})).code,400);
 assert.equal((await call({action:'custom_orders',data:{op:'create',member_id:mid,id:oid,version:0,full_amount:100,deposit_amount:0,paid_in_full:true,deposit_paid:false,created_by:'forged',notified:true}})).code,200);
});
test('LINE recipients and text come from database, and retries use persisted key',async()=>{
 let pushed=0,marked=0;global.fetch=async(url,options)=>{const a=auth(url);if(a)return a;
 if(String(url).endsWith('/rpc/admin_order_notify_v400')){const p=JSON.parse(options.body);if(p.p_action==='prepare')return response(job);assert.equal(p.p_action,'accept');assert.equal(p.p_data.request_id,key);marked++;return response({id:oid,notified:true});}
 assert.equal(url,'https://api.line.me/v2/bot/message/push');assert.equal(options.headers['X-Line-Retry-Key'],key);assert.deepEqual(JSON.parse(options.body),{to:job.line_id,messages:[{type:'text',text:job.message}]});pushed++;return response({},409,{'x-line-accepted-request-id':'existing-request'});
 };const r=await call(body);assert.equal(r.code,200);assert.equal(r.data.accepted,true);assert.equal(r.data.duplicate,true);assert.equal(pushed,1);assert.equal(marked,1);
});
test('accepted notification does not push again',async()=>{
 global.fetch=async url=>auth(url)||response({...job,status:'accepted'});const r=await call(body);assert.equal(r.data.duplicate,true);
});
test('missing LINE credentials is actionable and does not expose secrets',async()=>{
 const access=process.env.LINE_CHANNEL_ACCESS_TOKEN;delete process.env.LINE_CHANNEL_ACCESS_TOKEN;try{global.fetch=async url=>{const a=auth(url);if(a)return a;throw Error('unexpected send');};const r=await call(body);assert.equal(r.data.code,'LINE-MSG-CFG');assert.match(r.data.error,/系統設定/);}finally{process.env.LINE_CHANNEL_ACCESS_TOKEN=access;}
});
test('timeouts retain pending key; rejected tokens clear rejected attempt without marking sent',async()=>{
 for(const mode of ['timeout','401']){let accepted=false,rejected=false;global.fetch=async(url,options)=>{const a=auth(url);if(a)return a;if(String(url).includes('/rpc/')){const p=JSON.parse(options.body);if(p.p_action==='prepare')return response(job);if(p.p_action==='accept')accepted=true;if(p.p_action==='reject')rejected=true;return response({});}if(mode==='timeout')throw Error('network timeout');return response({message:'secret internal error'},401);};const r=await call(body);assert.equal(accepted,false);assert.equal(rejected,mode==='401');assert.equal(r.data.error.includes('secret'),false);assert.ok(r.code>=400);}
});
test('successful but null database response becomes useful error instead of empty data',async()=>{
 global.fetch=async url=>auth(url)||response(null);const r=await call({action:'custom_orders',data:{op:'list',member_id:mid}});assert.equal(r.code,502);assert.equal(r.data.code,'DB-RESPONSE');
});
