const timeout=()=>AbortSignal.timeout(20000);
function fail(message,status=400,code){const e=new Error(message);e.status=status;e.code=code;throw e;}
function databaseSettings(){
 const url=(process.env.SUPABASE_URL||'').trim().replace(/\/$/,'');const key=(process.env.SUPABASE_SECRET_KEY||'').trim();
 let parsed;try{parsed=new URL(url);}catch{fail('會員服務設定尚未完成（CFG-URL），請聯絡店家。',503,'CFG-URL');}
 if(parsed.protocol!=='https:'||parsed.pathname!=='/'||parsed.search||parsed.hash||parsed.username||parsed.password)fail('會員服務網址設定不正確（CFG-URL），請聯絡店家。',503,'CFG-URL');
 if(!key||key.startsWith('sb_publishable_')||(!key.startsWith('sb_secret_')&&!key.startsWith('eyJ')))fail('會員服務金鑰設定不正確（CFG-KEY），請聯絡店家。',503,'CFG-KEY');
 return {url,key};
}
async function rpc(name,body){
 const {url,key}=databaseSettings(),headers={apikey:key,'Content-Type':'application/json'};
 if(key?.startsWith('eyJ'))headers.Authorization=`Bearer ${key}`;
 let r;try{r=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify(body),signal:timeout()});}catch{fail('會員服務連線逾時（DB-NET），請稍後重試。',503,'DB-NET');}
 const d=await r.json().catch(()=>null);
 if(!r.ok){
  if(r.status===401)fail('會員服務驗證失敗（DB-KEY），請聯絡店家。',503,'DB-KEY');
  if(d?.code==='42501'){if(d.message==='沒有管理權限')fail('此帳號沒有管理權限',403);fail('會員服務存取權限不足（DB-PERM），請聯絡店家。',503,'DB-PERM');}
  if(r.status===403)fail('會員服務存取權限不足（DB-PERM），請聯絡店家。',503,'DB-PERM');
  if(['PGRST202','42883','42703','42P01'].includes(d?.code))fail('資料庫結構尚未完成或版本不一致；請執行 sql/10_repair_member_db_rpc.sql 後重新整理',503,'DB-SCHEMA');
  if(d?.code==='P0001')fail(d.message);
  if(['22P02','22007','22008','22003','23502','23514'].includes(d?.code))fail('資料格式不正確，請檢查金額、日期與會員編號');
  if(d?.code==='23505')fail('訂單編號已使用，請重新查詢確認交易');
  fail('會員資料暫時無法讀取（DB-RPC），請稍後重試或聯絡店家。',502,'DB-RPC');
 }return d;
}
function restHeaders(){
 const {key}=databaseSettings(),headers={apikey:key,'Content-Type':'application/json'};
 if(key?.startsWith('eyJ'))headers.Authorization=`Bearer ${key}`;
 return headers;
}
async function restGet(table,params={}){
 const {url}=databaseSettings(),u=new URL(url+`/rest/v1/${table}`);
 for(const [k,v] of Object.entries(params))if(v!==undefined&&v!==null)u.searchParams.set(k,String(v));
 let r;try{r=await fetch(u,{headers:restHeaders(),signal:timeout()});}catch{fail('會員服務連線逾時（DB-NET），請稍後重試。',503,'DB-NET');}
 const d=await r.json().catch(()=>null);
 if(!r.ok){
  if(r.status===401)fail('會員服務驗證失敗（DB-KEY），請聯絡店家。',503,'DB-KEY');
  if(r.status===403||d?.code==='42501')fail('會員服務存取權限不足（DB-PERM），請聯絡店家。',503,'DB-PERM');
  if(['42P01','42703'].includes(d?.code))fail('資料庫結構尚未完成或版本不一致',503,'DB-SCHEMA');
  fail('會員資料暫時無法讀取（DB-REST），請稍後重試或聯絡店家。',502,'DB-REST');
 }
 return Array.isArray(d)?d:[];
}

async function restWrite(method,table,params={},body=null,prefer='return=representation'){
 const {url}=databaseSettings(),u=new URL(url+`/rest/v1/${table}`);
 for(const [k,v] of Object.entries(params))if(v!==undefined&&v!==null)u.searchParams.set(k,String(v));
 const headers=restHeaders();if(prefer)headers.Prefer=prefer;
 let r;try{r=await fetch(u,{method,headers,body:body===null?undefined:JSON.stringify(body),signal:timeout()});}catch{fail('會員服務連線逾時（DB-NET），請稍後重試。',503,'DB-NET');}
 const text=await r.text(),d=text?(()=>{try{return JSON.parse(text)}catch{return null}})():null;
 if(!r.ok){
  if(r.status===401)fail('會員服務驗證失敗（DB-KEY），請聯絡店家。',503,'DB-KEY');
  if(r.status===403||d?.code==='42501')fail('會員服務存取權限不足（DB-PERM），請聯絡店家。',503,'DB-PERM');
  if(['42P01','42703','PGRST204'].includes(d?.code))fail('資料庫結構尚未完成；請執行新版 v3.9.2 的 sql/09_upgrade_v3_9_2_rebuild.sql',503,'DB-SCHEMA');
  if(d?.code==='23505')fail('資料已存在，請重新整理後再試');
  if(d?.code==='23503')fail('找不到對應會員資料');
  if(['23514','23502','22P02','22007','22008','22003'].includes(d?.code))fail('資料格式不正確，請檢查日期、金額與內容');
  fail('資料寫入暫時失敗（DB-REST），請稍後再試。',502,'DB-REST');
 }
 return d;
}
async function restAll(table,params={},pageSize=1000,maxRows=100000){
 const out=[];for(let offset=0;;offset+=pageSize){const rows=await restGet(table,{...params,offset,limit:pageSize});out.push(...rows);if(rows.length<pageSize)break;if(out.length>=maxRows)fail('資料筆數過多，請縮小查詢範圍',503,'DB-LIMIT');}return out;
}
function safeText(v,max=1000){return String(v??'').trim().slice(0,max)}
async function customOrdersDirect(actor,data={}){
 await requireAdminDirect(actor);const op=String(data.op||''),mid=data.member_id?cleanMemberId(data.member_id):null;
 if(op==='staff_list')return {staff:await restGet('staff_options',{select:'name,active,created_at',order:'name.asc',limit:500})};
 if(op==='staff_add'){
  const name=safeText(data.name,60);if(!name)fail('請輸入店員名字');
  const rows=await restWrite('POST','staff_options',{on_conflict:'name'},[{name,active:true,created_by:actor}],'resolution=merge-duplicates,return=representation');return {name,staff:rows};
 }
 if(op==='staff_set'){
  const name=safeText(data.name,60);if(!name)fail('請輸入店員名字');
  await restWrite('PATCH','staff_options',{name:`eq.${name}`},{active:!!data.active});return {name,active:!!data.active};
 }
 if(op==='list'){
  if(!mid)fail('請選擇會員');const [orders,staff]=await Promise.all([restGet('custom_orders',{select:'*',member_id:`eq.${mid}`,order:'paid_in_full.asc,ordered_at.desc,id.desc',limit:200}),restGet('staff_options',{select:'name',active:'eq.true',order:'name.asc',limit:500})]);
  return {orders,staff:staff.map(x=>x.name)};
 }
 if(op==='global'){
  const limit=Math.min(500,Math.max(1,Number(data.limit)||300)),orders=await restGet('custom_orders',{select:'*',order:'paid_in_full.asc,ordered_at.desc,id.desc',limit});
  const ids=[...new Set(orders.map(x=>x.member_id).filter(Boolean))],members=ids.length?await restGet('members',{select:'id,display_name,phone',id:`in.(${ids.join(',')})`,limit:ids.length+5}):[];
  const map=new Map(members.map(m=>[m.id,m])),q=safeText(data.query,200).toLowerCase();let joined=orders.map(o=>({...o,display_name:map.get(o.member_id)?.display_name||'未命名會員',phone:map.get(o.member_id)?.phone||''}));
  if(q)joined=joined.filter(o=>[o.display_name,o.phone,o.product_name,o.staff_name,o.note].some(v=>String(v||'').toLowerCase().includes(q)));return {orders:joined};
 }
 if(op==='create'){
  if(!mid)fail('請選擇會員');const product_name=safeText(data.product_name,200);if(!product_name)fail('請輸入客訂品名');const staff_name=safeText(data.staff_name,60),deposit_amount=Math.max(0,Math.min(10000000,Number(data.deposit_amount)||0));
  const row={member_id:mid,ordered_at:data.ordered_at||new Date().toISOString(),product_name,deposit_amount,deposit_paid:!!data.deposit_paid,paid_in_full:!!data.paid_in_full,staff_name,notified:!!data.notified,notified_at:data.notified?new Date().toISOString():null,notified_by:data.notified?actor:null,created_by:actor,note:safeText(data.note,1000)};
  const created=await restWrite('POST','custom_orders',{},[row]);if(staff_name)await restWrite('POST','staff_options',{on_conflict:'name'},[{name:staff_name,active:true,created_by:actor}],'resolution=merge-duplicates,return=minimal');return Array.isArray(created)?created[0]:created;
 }
 if(op==='update'){
  if(!mid||!UUID_RE.test(String(data.id||'')))fail('客訂編號格式不正確');const patch={updated_at:new Date().toISOString()};
  for(const k of ['deposit_paid','paid_in_full','notified'])if(k in data)patch[k]=!!data[k];if('product_name'in data){patch.product_name=safeText(data.product_name,200);if(!patch.product_name)fail('請輸入客訂品名');}if('staff_name'in data)patch.staff_name=safeText(data.staff_name,60);if('deposit_amount'in data)patch.deposit_amount=Math.max(0,Math.min(10000000,Number(data.deposit_amount)||0));if('ordered_at'in data)patch.ordered_at=data.ordered_at;if('note'in data)patch.note=safeText(data.note,1000);
  if('notified'in data){patch.notified_at=data.notified?new Date().toISOString():null;patch.notified_by=data.notified?actor:null;}
  const rows=await restWrite('PATCH','custom_orders',{id:`eq.${data.id}`,member_id:`eq.${mid}`},patch);if(!rows?.length)fail('找不到客訂資料');return rows[0];
 }
 if(op==='delete'){
  if(!mid||!UUID_RE.test(String(data.id||'')))fail('客訂編號格式不正確');await restWrite('DELETE','custom_orders',{id:`eq.${data.id}`,member_id:`eq.${mid}`},null,'return=minimal');return {deleted:true,id:data.id};
 }
 if(op==='notify_target'){
  if(!mid||!UUID_RE.test(String(data.id||'')))fail('客訂編號格式不正確');const [orders,members]=await Promise.all([restGet('custom_orders',{select:'id,member_id,product_name,deposit_amount,deposit_paid,paid_in_full,staff_name',id:`eq.${data.id}`,member_id:`eq.${mid}`,limit:1}),restGet('members',{select:'id,line_id,display_name',id:`eq.${mid}`,limit:1})]);if(!orders.length||!members.length)fail('找不到客訂或會員資料');return {line_id:members[0].line_id,display_name:members[0].display_name,order:orders[0]};
 }
 if(op==='notify_mark'){
  if(!mid||!UUID_RE.test(String(data.id||'')))fail('客訂編號格式不正確');const rows=await restWrite('PATCH','custom_orders',{id:`eq.${data.id}`,member_id:`eq.${mid}`},{notified:true,notified_at:new Date().toISOString(),notified_by:actor,updated_at:new Date().toISOString()});if(!rows?.length)fail('找不到客訂資料');return rows[0];
 }
 fail('不支援的客訂操作');
}
function monthBounds(month){const [y,m]=month.split('-').map(Number),start=new Date(`${month}-01T00:00:00+08:00`),nextM=m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,'0')}`,end=new Date(`${nextM}-01T00:00:00+08:00`),prevM=m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,'0')}`,prev=new Date(`${prevM}-01T00:00:00+08:00`);return {start,end,prev};}
function summaryTx(rows){const active=rows.filter(t=>!t.voided_at),customers=new Set(active.map(t=>t.member_id));return {paid:active.reduce((s,t)=>s+Number(t.paid||0),0),earned:active.reduce((s,t)=>s+Number(t.earned||0),0),redeemed:active.reduce((s,t)=>s+Number(t.redeemed||0),0),visits:active.length,customers:customers.size,average:active.length?Math.round(active.reduce((s,t)=>s+Number(t.paid||0),0)/active.length*100)/100:0};}
async function reportDirect(actor,month){
 await requireAdminDirect(actor);const {start,end,prev}=monthBounds(month),rows=await restAll('transactions',{select:'member_id,paid,earned,redeemed,occurred_at,items,voided_at',occurred_at:`gte.${prev.toISOString()}`,and:`(occurred_at.lt.${end.toISOString()})`,order:'occurred_at.asc'},1000,100000),cur=rows.filter(t=>new Date(t.occurred_at)>=start&&new Date(t.occurred_at)<end),old=rows.filter(t=>new Date(t.occurred_at)>=prev&&new Date(t.occurred_at)<start),valid=cur.filter(t=>!t.voided_at);
 const dayMap=new Map();for(let d=new Date(start);d<end;d=new Date(d.getTime()+86400000)){const key=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);dayMap.set(key,{day:key,paid:0,earned:0,redeemed:0,visits:0});}for(const t of valid){const key=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t.occurred_at)),d=dayMap.get(key);if(d){d.paid+=Number(t.paid||0);d.earned+=Number(t.earned||0);d.redeemed+=Number(t.redeemed||0);d.visits++;}}
 const counts=new Map(),products=new Map();for(const t of valid){counts.set(t.member_id,(counts.get(t.member_id)||0)+1);for(const i of Array.isArray(t.items)?t.items:[]){const name=safeText(i.name,200)||'未命名';const x=products.get(name)||{name,quantity:0,gross:0};x.quantity+=Number(i.qty||0);x.gross+=Number(i.qty||0)*Number(i.price||0);products.set(name,x);}}
 const frequency=[{label:'消費 1 次',value:[...counts.values()].filter(n=>n===1).length},{label:'消費 2 次',value:[...counts.values()].filter(n=>n===2).length},{label:'消費 3 次以上',value:[...counts.values()].filter(n=>n>=3).length}],activeIds=[...counts.keys()];let returning=0,newCount=0;
 if(activeIds.length){const earlier=await restGet('transactions',{select:'member_id,occurred_at',member_id:`in.(${activeIds.join(',')})`,occurred_at:`lt.${start.toISOString()}`,voided_at:'is.null',limit:10000}),seen=new Set(earlier.map(x=>x.member_id));for(const id of activeIds)seen.has(id)?returning++:newCount++;}
 return {month,current:summaryTx(cur),previous:summaryTx(old),days:[...dayMap.values()],frequency,products:[...products.values()].sort((a,b)=>b.quantity-a.quantity||a.name.localeCompare(b.name)).slice(0,20),customer_types:{new:newCount,returning},start_at:start.toISOString(),end_at:end.toISOString(),previous_at:prev.toISOString(),previous_end:start.toISOString(),mode:'same',generated_at:new Date().toISOString()};
}

async function compareDirect(actor,month,offset=0,sort='paid'){
 await requireAdminDirect(actor);const {start,end,prev}=monthBounds(month),rows=await restAll('transactions',{select:'member_id,paid,earned,occurred_at,voided_at',occurred_at:`gte.${prev.toISOString()}`,and:`(occurred_at.lt.${end.toISOString()})`,order:'occurred_at.asc'},1000,100000),per=new Map();
 for(const t of rows){if(t.voided_at)continue;let x=per.get(t.member_id);if(!x){x={id:t.member_id,paid:0,previous_paid:0,visits:0,previous_visits:0,earned:0};per.set(t.member_id,x);}const dt=new Date(t.occurred_at);if(dt>=start){x.paid+=Number(t.paid||0);x.visits++;x.earned+=Number(t.earned||0);}else{x.previous_paid+=Number(t.paid||0);x.previous_visits++;}}
 const ids=[...per.keys()],members=ids.length?await restGet('members',{select:'id,display_name,phone',id:`in.(${ids.join(',')})`,limit:ids.length+5}):[],map=new Map(members.map(m=>[m.id,m]));let out=[...per.values()].map(x=>({...x,display_name:map.get(x.id)?.display_name||'未命名會員',phone:map.get(x.id)?.phone||'',paid_diff:x.paid-x.previous_paid,visits_diff:x.visits-x.previous_visits}));out.sort((a,b)=>(sort==='visits'?b.visits-a.visits:b.paid-a.paid)||a.id.localeCompare(b.id));const page=out.slice(offset,offset+51),more=page.length>50;return {rows:more?page.slice(0,50):page,has_more:more};
}
async function exportDirect(actor,month,cursor){
 await requireAdminDirect(actor);const {start,end}=monthBounds(month),offset=Math.max(0,Number(cursor?.offset)||0),rows=await restGet('transactions',{select:'id,member_id,gross,redeemed,paid,earned,occurred_at,items,note,external_id,voided_at,void_reason',occurred_at:`gte.${start.toISOString()}`,and:`(occurred_at.lt.${end.toISOString()})`,order:'occurred_at.desc,id.desc',offset,limit:201}),more=rows.length>200,page=more?rows.slice(0,200):rows,ids=[...new Set(page.map(x=>x.member_id))],members=ids.length?await restGet('members',{select:'id,display_name,phone',id:`in.(${ids.join(',')})`,limit:ids.length+5}):[],map=new Map(members.map(m=>[m.id,m]));return {rows:page.map(t=>({...t,display_name:map.get(t.member_id)?.display_name||'未命名會員',phone:map.get(t.member_id)?.phone||''})),next:more?{offset:offset+200}:null};
}

async function ledgerDirect(actor,data={}){
 await requireAdminDirect(actor);const mid=cleanMemberId(data.member_id),tx=await restAll('transactions',{select:'id,earned,redeemed,occurred_at,voided_at,void_reason',member_id:`eq.${mid}`,order:'occurred_at.asc,id.asc'},1000,100000),events=[];
 for(const t of tx){events.push({id:`${t.id}:sale`,created_at:t.occurred_at,action:'sale',earned:Number(t.earned||0),redeemed:-Number(t.redeemed||0),transaction_id:t.id,reason:''});if(t.voided_at)events.push({id:`${t.id}:void`,created_at:t.voided_at,action:'void',earned:-Number(t.earned||0),redeemed:Number(t.redeemed||0),transaction_id:t.id,reason:t.void_reason||''});}
 events.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)||a.id.localeCompare(b.id));let bal=0;for(const e of events){bal+=e.earned+e.redeemed;e.balance=bal;}events.reverse();const offset=Math.max(0,Number(data.before)||0),page=events.slice(offset,offset+51),more=page.length>50;return {rows:more?page.slice(0,50):page,next:more?offset+50:null};
}
async function profileDirect(actor,data={}){await requireAdminDirect(actor);const mid=cleanMemberId(data.member_id),display_name=safeText(data.display_name,100);if(!display_name)fail('姓名不可空白');const rows=await restWrite('PATCH','members',{id:`eq.${mid}`},{display_name,phone:safeText(data.phone,30),note:safeText(data.note,1000)});if(!rows?.length)fail('找不到會員');return {member:rows[0]};}
async function healthDirect(actor){await requireAdminDirect(actor);await Promise.all([restGet('members',{select:'id',limit:1}),restGet('transactions',{select:'id',limit:1}),restGet('custom_orders',{select:'id',limit:1}),restGet('staff_options',{select:'name',limit:1})]);return {schema_version:'3.9.2-stable',checked_at:new Date().toISOString()};}
async function backupDirect(actor){await requireAdminDirect(actor);const [admins,members,transactions,audit,staff_options,custom_orders]=await Promise.all([restAll('admins',{select:'*'},1000,10000),restAll('members',{select:'*'},1000,100000),restAll('transactions',{select:'*'},1000,100000),restAll('audit',{select:'*'},1000,100000),restAll('staff_options',{select:'*'},1000,10000),restAll('custom_orders',{select:'*'},1000,100000)]);return {format:'line-member-business',version:4,created_at:new Date().toISOString(),admins,members,transactions,audit,staff_options,custom_orders,points:transactions.filter(t=>!t.voided_at).reduce((s,t)=>s+Number(t.earned||0)-Number(t.redeemed||0),0)};}
async function requireAdminDirect(actor){
 const rows=await restGet('admins',{select:'user_id',user_id:`eq.${actor}`,limit:1});
 if(!rows.length)fail('此帳號沒有管理權限',403);
}
function pgQuotedLike(value){return `*${String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"')}*`;}
async function membersDirect(actor,query='',offset=0){
 await requireAdminDirect(actor);const q=String(query||'').trim(),params={select:'id,display_name,phone,note,created_at',order:'created_at.desc,id.asc',offset:Math.max(0,offset),limit:51};
 if(q){
  if(UUID_RE.test(q))params.or=`(id.eq.${q},display_name.ilike.${pgQuotedLike(q)},phone.ilike.${pgQuotedLike(q)})`;
  else params.or=`(display_name.ilike.${pgQuotedLike(q)},phone.ilike.${pgQuotedLike(q)})`;
 }
 const rows=await restGet('members',params),has_more=rows.length>50;
 return {rows:has_more?rows.slice(0,50):rows,has_more};
}
async function memberTotalsDirect(memberId){
 let offset=0,total=0,points=0,visits=0;
 for(;;){
  const rows=await restGet('transactions',{select:'paid,earned,redeemed,voided_at',member_id:`eq.${memberId}`,order:'occurred_at.desc',offset,limit:1000});
  for(const t of rows)if(!t.voided_at){total+=Number(t.paid||0);points+=Number(t.earned||0)-Number(t.redeemed||0);visits++;}
  if(rows.length<1000)break;offset+=1000;if(offset>100000)fail('會員交易筆數過多，請聯絡店家處理',503,'DB-LIMIT');
 }
 return {total,points,visits};
}
async function detailDirect(actor,memberId,cursor=null,summary=true){
 await requireAdminDirect(actor);
 const members=await restGet('members',{select:'id,display_name,phone,note,created_at',id:`eq.${memberId}`,limit:1});
 if(!members.length)fail('找不到會員');
 const offset=Math.max(0,Number(cursor?.offset)||0),rows=await restGet('transactions',{select:'id,gross,redeemed,paid,earned,occurred_at,voided_at,items,note,void_reason,external_id',member_id:`eq.${memberId}`,order:'occurred_at.desc,id.desc',offset,limit:21});
 const more=rows.length>20,transactions=more?rows.slice(0,20):rows,result={transactions,next:more?{offset:offset+20}:null};
 if(summary)Object.assign(result,await memberTotalsDirect(memberId),{member:members[0]});
 return result;
}
async function verifiedLine(token){
 if(!token)fail('請先使用 LINE 登入',401);
 const r=await fetch('https://api.line.me/oauth2/v2.1/verify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({id_token:token,client_id:(process.env.LINE_CHANNEL_ID||'').trim()}),signal:timeout()});
 const d=await r.json();if(!r.ok||!d.sub)fail('LINE 登入已失效，請重新開啟會員頁',401);return d;
}
async function verifiedUser(token){
 if(!token)fail('請先登入管理端',401);
 const r=await fetch((process.env.SUPABASE_URL||'').trim().replace(/\/$/,'')+'/auth/v1/user',{headers:{apikey:(process.env.SUPABASE_PUBLISHABLE_KEY||'').trim(),Authorization:`Bearer ${token}`},signal:timeout()});
 const d=await r.json();if(r.status>=500||r.status===429)fail('登入服務暫時忙碌，請稍後重試',503);if(!r.ok||!d.id)fail('管理登入已過期，請重新登入',401);return d.id;
}
const ACCESS_COOKIE='__Host-mp_access',REFRESH_COOKIE='__Host-mp_refresh';
function cookies(req){const out={};for(const part of (req.headers.cookie||'').split(';')){const pos=part.indexOf('=');if(pos<0)continue;try{out[part.slice(0,pos).trim()]=decodeURIComponent(part.slice(pos+1));}catch{}}return out;}
function sessionCookies(res,access,refresh){
 const make=(name,value)=>`${name}=${encodeURIComponent(value||'')}; Path=/; HttpOnly; Secure; SameSite=Lax${value?'':'; Max-Age=0'}`;
 // Session cookies survive refresh; no token is readable by client-side JavaScript.
 res.setHeader('Set-Cookie',[make(ACCESS_COOKIE,access),make(REFRESH_COOKIE,refresh)]);
}
async function restoreSession(req,res){
 const jar=cookies(req);let actor;
 if(jar[ACCESS_COOKIE]){
  try{actor=await verifiedUser(jar[ACCESS_COOKIE]);}catch(e){if(e.status!==401)throw e;}
 }
 if(actor){try{await requireAdminDirect(actor);return actor;}catch(e){if(e.status===403)sessionCookies(res,'','');throw e;}}
 if(!jar[REFRESH_COOKIE]){sessionCookies(res,'','');fail('請先登入管理端',401);}
 const r=await fetch((process.env.SUPABASE_URL||'').trim().replace(/\/$/,'')+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:(process.env.SUPABASE_PUBLISHABLE_KEY||'').trim(),'Content-Type':'application/json'},body:JSON.stringify({refresh_token:jar[REFRESH_COOKIE]}),signal:timeout()});
 const d=await r.json();
 if(!r.ok||!d.access_token||!d.refresh_token){
  if(r.status>=500||r.status===429)fail('登入服務暫時忙碌，請稍後重試',503);
  sessionCookies(res,'','');fail('登入已失效，請重新登入',401);
 }
 actor=await verifiedUser(d.access_token);try{await requireAdminDirect(actor);}catch(e){if(e.status===403)sessionCookies(res,'','');throw e;}sessionCookies(res,d.access_token,d.refresh_token);return actor;
}
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,MONTH_RE=/^\d{4}-(0[1-9]|1[0-2])$/;
function cleanMemberId(v){const s=String(v||'').trim();if(!UUID_RE.test(s))fail('會員編號格式不正確');return s.toLowerCase();}
function cleanMonth(v){const s=String(v||'').trim();if(!MONTH_RE.test(s))fail('月份格式不正確');return s;}
export default async function handler(req,res){
 const began=performance.now();res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 const send=d=>{res.setHeader('Server-Timing',`app;dur=${Math.round(performance.now()-began)}`);return res.json(d);};
 try{
  if(req.method!=='POST')return res.status(405).json({error:'請使用 POST'});
  const fetchSite=String(req.headers['sec-fetch-site']||'');if(fetchSite==='cross-site')fail('來源不允許',403);
  if(req.headers.origin&&req.headers.origin!==`https://${req.headers.host}`)fail('來源不允許',403);
  if(req.headers['x-member-app']!=='1')fail('請重新整理網站後再操作',403);
  let b;try{b=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{fail('請求格式不正確');}
  if(!b||typeof b!=='object'||Array.isArray(b))fail('請求格式不正確');
  if(JSON.stringify(b).length>1000000)fail('檔案過大，請拆成較小批次',413);
  const token=(req.headers.authorization||'').replace(/^Bearer /,'');
  const jar=cookies(req);
  if(b.action==='config')return send({liffId:process.env.LIFF_ID,store:process.env.STORE_NAME||'會員點數',business:process.env.BUSINESS_NAME||'',contact:process.env.SUPPORT_CONTACT||''});
  if(b.action==='login'){
   if(typeof b.email!=='string'||typeof b.password!=='string'||b.email.length>254||b.password.length>1000)fail('請輸入正確帳號密碼');
   const r=await fetch((process.env.SUPABASE_URL||'').trim().replace(/\/$/,'')+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:(process.env.SUPABASE_PUBLISHABLE_KEY||'').trim(),'Content-Type':'application/json'},body:JSON.stringify({email:b.email,password:b.password}),signal:timeout()});
   const d=await r.json();if(!r.ok)fail('帳號或密碼錯誤，或嘗試次數過多',401);
   const actor=await verifiedUser(d.access_token);await requireAdminDirect(actor);
   if(!d.refresh_token)fail('登入服務未回傳完整憑證',502);
   sessionCookies(res,d.access_token,d.refresh_token);return send({authenticated:true});
  }
  if(b.action==='session'){await restoreSession(req,res);return send({authenticated:true});}
  if(b.action==='logout'){
   // Always remove this browser's credentials. Revocation is best effort if Auth is offline.
   sessionCookies(res,'','');let revoked=false;
   if(jar[ACCESS_COOKIE])try{const r=await fetch((process.env.SUPABASE_URL||'').trim().replace(/\/$/,'')+'/auth/v1/logout?scope=local',{method:'POST',headers:{apikey:(process.env.SUPABASE_PUBLISHABLE_KEY||'').trim(),Authorization:`Bearer ${jar[ACCESS_COOKIE]}`},signal:timeout()});revoked=r.ok;}catch{}
   return send({authenticated:false,revoked});
  }
  if(b.action==='me'){
   const v=await verifiedLine(token);
   const d=await rpc('line_page_v2',{p_line:v.sub,p_name:v.name||'LINE 會員',p_cursor:b.before_day?{day:b.before_day}:null});
   // Explicit allowlist: customers never receive transaction details, even during migration.
   return send({member:{id:d.member.id,display_name:d.member.display_name},total:d.total,points:d.points,visits:d.visits,point_days:(d.point_days||[]).map(x=>({day:x.day,earned:x.earned})),next_day:d.next_day||null});
  }
  const actor=await verifiedUser(jar[ACCESS_COOKIE]||token);
  const args={p_actor:actor};
  if(b.action==='backup')return send(await backupDirect(actor));
  if(b.action==='health')return send(await healthDirect(actor));
  if(b.action==='ledger')return send(await ledgerDirect(actor,b.data||{}));
  if(['audit','reconcile'].includes(b.action))return send(await rpc('admin_operations_v3',{...args,p_action:b.action,p_data:b.data||{}}));
  if(b.action==='search'){const q=String(b.query||'').trim();if(q.length>200)fail('搜尋內容過長');return send(await membersDirect(actor,q,Math.max(0,parseInt(b.offset)||0)));}
  if(b.action==='detail'){const mid=cleanMemberId(b.member_id),cursor=b.cursor||null;return send(await detailDirect(actor,mid,cursor,!cursor));}
  if(b.action==='custom_orders')return send(await customOrdersDirect(actor,b.data||{}));
  if(b.action==='notify_order'){
   const data=b.data||{},target=await customOrdersDirect(actor,{...data,op:'notify_target'});
   const access=(process.env.LINE_CHANNEL_ACCESS_TOKEN||'').trim();if(!access)fail('尚未設定 LINE Messaging API。請在環境變數加入 LINE_CHANNEL_ACCESS_TOKEN。',503,'LINE-MSG-CFG');
   const item=String(target?.order?.product_name||'客訂商品'),name=String(target?.display_name||'會員'),store=process.env.STORE_NAME||'門市';
   const text=`${name}您好，您在 ${store} 客訂的「${item}」已有最新進度，歡迎與我們聯繫或到店確認，謝謝您。`;
   let r;try{r=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},body:JSON.stringify({to:target.line_id,messages:[{type:'text',text:text.slice(0,5000)}]}),signal:timeout()});}catch{fail('LINE 通知連線逾時，尚未標記為已通知',503,'LINE-MSG-NET');}
   if(!r.ok){const err=await r.json().catch(()=>null);fail(err?.message?`LINE 通知失敗：${err.message}`:'LINE 通知失敗，尚未標記為已通知',502,'LINE-MSG');}
   const marked=await customOrdersDirect(actor,{...data,op:'notify_mark'});return send({sent:true,order:marked});
  }
  if(b.action==='profile')return send(await profileDirect(actor,b.data||{}));
  if(['sale','void','items'].includes(b.action))return send(await rpc('admin_write_v2',{...args,p_action:b.action,p_data:b.data||{}}));
  if(b.action==='report')return send(await reportDirect(actor,cleanMonth(b.month)));
  if(b.action==='compare')return send(await compareDirect(actor,cleanMonth(b.month),Math.max(0,parseInt(b.offset)||0),b.sort==='visits'?'visits':'paid'));
  if(b.action==='export')return send(await exportDirect(actor,cleanMonth(b.month),b.cursor||null));
  if(b.action==='import')return send(await rpc('admin_import_v2',{...args,p_rows:b.rows,p_dry:b.dry_run!==false}));
  fail('不支援的操作');
 }catch(e){if(e.status===403&&e.message==='此帳號沒有管理權限')sessionCookies(res,'','');res.status(e.status||500).json({error:e.status?e.message:'暫時無法連線，請稍後重試或檢查服務設定',...(e.code?{code:e.code}:{})});}
}
