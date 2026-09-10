import test from 'node:test';import assert from 'node:assert/strict';
async function core(id){global.document={querySelector:()=>null};global.location={pathname:'/admin.html'};global.window=new EventTarget();return import('../public/core.js?test='+id);}
const response=(d,status=200)=>new Response(JSON.stringify(d),{status});
test('concurrent expired admin requests share one refresh and retry once',async()=>{
 const c=await core('parallel');let refreshed=false,count=0;let release;const gate=new Promise(r=>release=r);let started;const began=new Promise(r=>started=r);
 global.fetch=async(url,options)=>{assert.equal(options.credentials,'same-origin');assert.equal(options.headers['X-Member-App'],'1');const b=JSON.parse(options.body);if(b.action==='session'){count++;started();await gate;refreshed=true;return response({authenticated:true});}return refreshed?response({ok:b.action}):response({error:'expired'},401);};
 const a=c.api('report'),b=c.api('compare');await began;release();const results=await Promise.all([a,b]);assert.equal(count,1);assert.equal(results.length,2);
});
test('logout waits for a pending refresh before clearing the browser session',async()=>{
 const c=await core('logout');let release,started;const gate=new Promise(r=>release=r),began=new Promise(r=>started=r);const order=[];let fresh=false;
 global.fetch=async(url,options)=>{const b=JSON.parse(options.body);if(b.action==='session'){started();await gate;order.push('refresh');fresh=true;return response({authenticated:true});}if(b.action==='logout'){order.push('logout');return response({authenticated:false});}return fresh?response({ok:true}):response({error:'expired'},401);};
 const work=c.api('report');await began;const logout=c.api('logout');release();await Promise.all([work,logout]);assert.deepEqual(order,['refresh','logout']);
});
