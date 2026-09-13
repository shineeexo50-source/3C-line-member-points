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
  if(['PGRST202','42883','42703','42P01'].includes(d?.code))fail((name.endsWith('v400')?'請先執行 sql/10_upgrade_v4_0_0.sql，再重新載入。':'資料庫版本不一致，請依README確認04、06、08、09與10升級檔。'),503,'DB-SCHEMA');
  if(d?.code==='P0001')fail(d.message);
  if(['22P02','22007','22008','22003','23502','23514'].includes(d?.code))fail('資料格式不正確，請檢查金額、日期與會員編號');
  if(d?.code==='23505')fail('訂單編號已使用，請重新查詢確認交易');
  fail('會員資料暫時無法讀取（DB-RPC），請稍後重試或聯絡店家。',502,'DB-RPC');
 }if(d===null||typeof d!=='object')fail('資料服務回應不完整，請稍後重試',502,'DB-RESPONSE');return d;
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
 if(!Array.isArray(d))fail('資料服務回應不完整，請稍後重試',502,'DB-RESPONSE');return d;
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
  if(['42P01','42703','PGRST204'].includes(d?.code))fail('資料庫結構尚未完成；請依README確認V4.0.0升級步驟',503,'DB-SCHEMA');
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
 const op=String(data.op||'');
 if(!['list','global','create','update','delete','staff_list','staff_add','staff_set'].includes(op))fail('不支援的客訂操作');
 const allowed=['member_id','id','version','ordered_at','product_name','deposit_amount','deposit_paid','full_amount','paid_in_full','staff_name','note','name','active','query','offset','limit'];
 const clean=Object.fromEntries(allowed.filter(k=>Object.hasOwn(data,k)).map(k=>[k,data[k]]));
 if(['list','create','update','delete'].includes(op))clean.member_id=cleanMemberId(data.member_id);
 if(['create','update','delete'].includes(op)){
  if(!UUID_RE.test(String(data.id||''))||!Number.isSafeInteger(data.version)||data.version<0)fail('客訂資料版本不正確，請重新載入');
 }
 if(['create','update'].includes(op)){
  for(const k of ['deposit_amount','full_amount'])if(!Number.isSafeInteger(data[k])||data[k]<0||data[k]>10000000)fail('請填寫正確的整數金額');
  for(const k of ['deposit_paid','paid_in_full'])if(typeof data[k]!=='boolean')fail('請選擇付款狀態');
 }
 return rpc('admin_custom_orders_v400',{p_actor:actor,p_action:op,p_data:clean});
}
function lineConfigured(){const access=(process.env.LINE_CHANNEL_ACCESS_TOKEN||'').trim();return !!access&&!/^YOUR_|^REPLACE_|^<|\s/.test(access);}
async function notifyOrder(actor,data){
 await requireAdminDirect(actor);
 const mid=cleanMemberId(data.member_id);if(!UUID_RE.test(String(data.id||''))||!Number.isSafeInteger(data.version))fail('客訂資料不完整，請重新載入');
 if(!lineConfigured())fail('LINE通知尚未啟用，請到「系統設定 → LINE通知」查看設定方式。',409,'LINE-MSG-CFG');
 const args={id:data.id,member_id:mid,version:data.version,store:process.env.STORE_NAME||'門市'};
 const job=await rpc('admin_order_notify_v400',{p_actor:actor,p_action:'prepare',p_data:args});
 if(job.status==='accepted')return {accepted:true,duplicate:true};
 if(!UUID_RE.test(job.id)||!/^U[0-9a-f]{32}$/i.test(job.line_id)||typeof job.message!=='string')fail('LINE通知資料不完整，請重新载入會員資料',502,'LINE-TARGET');
 let r;try{r=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:`Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN.trim()}`,'Content-Type':'application/json','X-Line-Retry-Key':job.id},body:JSON.stringify({to:job.line_id,messages:[{type:'text',text:job.message}]}),signal:timeout()});}
 catch{fail('LINE通知結果尚待確認。可按同一筆通知重試，系統會沿用識別碼避免重複發送。',503,'LINE-MSG-NET');}
 const accepted=r.ok||(r.status===409&&!!r.headers.get('x-line-accepted-request-id'));
 if(!accepted){
  if(r.status>=400&&r.status<500&&r.status!==409)await rpc('admin_order_notify_v400',{p_actor:actor,p_action:'reject',p_data:{...args,request_id:job.id}});
  if(r.status===401||r.status===403)fail('LINE發訊憑證無效或權限不足，請在系統設定查看啟用方式。',409,'LINE-MSG-AUTH');
  if(r.status===429)fail('LINE通知額度已用完或操作太頻繁，請稍後重試並檢查官方帳號額度。',429,'LINE-MSG-LIMIT');
  if(r.status===400)fail('LINE無法接受此通知，請確認會員LINE綁定及官方帳號設定。',400,'LINE-MSG-TARGET');
  fail('LINE暫時無法確認通知結果，請稍後用同一筆通知重試。',502,'LINE-MSG');
 }
 try{const order=await rpc('admin_order_notify_v400',{p_actor:actor,p_action:'accept',p_data:{...args,request_id:job.id}});return {accepted:true,duplicate:r.status===409,order};}
 catch{fail('LINE已受理，但通知紀錄尚未同步。請按同一筆通知重試完成同步。',503,'LINE-MSG-SYNC');}
}
function monthBounds(month){const [y,m]=month.split('-').map(Number),start=new Date(`${month}-01T00:00:00+08:00`),nextM=m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,'0')}`,end=new Date(`${nextM}-01T00:00:00+08:00`),prevM=m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,'0')}`,prev=new Date(`${prevM}-01T00:00:00+08:00`);return {start,end,prev};}
async function exportDirect(actor,month,cursor){
 await requireAdminDirect(actor);const {start,end}=monthBounds(month),offset=Math.max(0,Number(cursor?.offset)||0),rows=await restGet('transactions',{select:'id,member_id,gross,redeemed,paid,earned,occurred_at,items,note,external_id,voided_at,void_reason',occurred_at:`gte.${start.toISOString()}`,and:`(occurred_at.lt.${end.toISOString()})`,order:'occurred_at.desc,id.desc',offset,limit:201}),more=rows.length>200,page=more?rows.slice(0,200):rows,ids=[...new Set(page.map(x=>x.member_id))],members=ids.length?await restGet('members',{select:'id,display_name,phone',id:`in.(${ids.join(',')})`,limit:ids.length+5}):[],map=new Map(members.map(m=>[m.id,m]));return {rows:page.map(t=>({...t,display_name:map.get(t.member_id)?.display_name||'未命名會員',phone:map.get(t.member_id)?.phone||''})),next:more?{offset:offset+200}:null};
}

async function profileDirect(actor,data={}){await requireAdminDirect(actor);const mid=cleanMemberId(data.member_id),display_name=safeText(data.display_name,100);if(!display_name)fail('姓名不可空白');const rows=await restWrite('PATCH','members',{id:`eq.${mid}`},{display_name,phone:safeText(data.phone,30),note:safeText(data.note,1000)});if(!rows?.length)fail('找不到會員');return {member:rows[0]};}
async function healthDirect(actor){await requireAdminDirect(actor);await Promise.all([restGet('members',{select:'id',limit:1}),restGet('transactions',{select:'id',limit:1}),restGet('custom_orders',{select:'id,version,full_amount,deleted_at',limit:1}),restGet('staff_options',{select:'name',limit:1})]);return {schema_version:'4.0.0',checked_at:new Date().toISOString()};}
async function backupDirect(actor){return rpc('admin_backup_v400',{p_actor:actor});}
async function requireAdminDirect(actor){
 const rows=await restGet('admins',{select:'user_id',user_id:`eq.${actor}`,limit:1});
 if(!rows.length)fail('此帳號沒有管理權限',403);
}
function pgQuotedLike(value){return '"*'+String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[%_*]/g,c=>'\\'+c)+'*"';}
async function membersDirect(actor,query='',offset=0){
 await requireAdminDirect(actor);const q=String(query||'').trim(),params={select:'id,display_name,phone,note,created_at',order:'created_at.desc,id.asc',offset:Math.max(0,offset),limit:51};
 if(q){
  if(UUID_RE.test(q))params.or=`(id.eq.${q},display_name.ilike.${pgQuotedLike(q)},phone.ilike.${pgQuotedLike(q)})`;
  else params.or=`(display_name.ilike.${pgQuotedLike(q)},phone.ilike.${pgQuotedLike(q)})`;
 }
 const rows=await restGet('members',params),has_more=rows.length>50;
 return {rows:has_more?rows.slice(0,50):rows,has_more};
}
async function verifiedLine(token){
 if(!token)fail('請先使用 LINE 登入',401);
 const r=await fetch('https://api.line.me/oauth2/v2.1/verify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({id_token:token,client_id:(process.env.LINE_CHANNEL_ID||'').trim()}),signal:timeout()});
 const d=await r.json();if(!r.ok||!d?.sub)fail('LINE 登入已失效，請重新開啟會員頁',401);return d;
}
async function verifiedUser(token){
 if(!token)fail('請先登入管理端',401);
 const r=await fetch((process.env.SUPABASE_URL||'').trim().replace(/\/$/,'')+'/auth/v1/user',{headers:{apikey:(process.env.SUPABASE_PUBLISHABLE_KEY||'').trim(),Authorization:`Bearer ${token}`},signal:timeout()});
 const d=await r.json();if(r.status>=500||r.status===429)fail('登入服務暫時忙碌，請稍後重試',503);if(!r.ok||!d?.id)fail('管理登入已過期，請重新登入',401);return d.id;
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
  if(b.action==='ledger')return send(await rpc('admin_operations_v3',{...args,p_action:'ledger',p_data:b.data||{}}));
  if(['audit','reconcile'].includes(b.action))return send(await rpc('admin_operations_v3',{...args,p_action:b.action,p_data:b.data||{}}));
  if(b.action==='search'){const q=String(b.query||'').trim();if(q.length>200)fail('搜尋內容過長');return send(await membersDirect(actor,q,Math.max(0,parseInt(b.offset)||0)));}
  if(b.action==='detail'){const mid=cleanMemberId(b.member_id),cursor=b.cursor||null;return send(await rpc('admin_detail_v400',{...args,p_member:mid,p_offset:Math.max(0,parseInt(cursor?.offset)||0),p_summary:!cursor}));}
  if(b.action==='custom_orders')return send(await customOrdersDirect(actor,b.data||{}));
  if(b.action==='notify_order')return send(await notifyOrder(actor,b.data||{}));
  if(b.action==='line_status'){await requireAdminDirect(actor);return send({configured:lineConfigured(),manager_url:'https://chat.line.biz/',guide_url:'https://developers.line.biz/en/docs/messaging-api/getting-started/'});}
  if(b.action==='profile')return send(await profileDirect(actor,b.data||{}));
  if(['sale','void','items'].includes(b.action))return send(await rpc('admin_write_v2',{...args,p_action:b.action,p_data:b.data||{}}));
  if(b.action==='report')return send(await rpc('admin_report_v3',{...args,p_month:cleanMonth(b.month),p_mode:b.mode==='full'?'full':'same'}));
  if(b.action==='compare')return send(await rpc('admin_compare_v3',{...args,p_month:cleanMonth(b.month),p_offset:Math.max(0,parseInt(b.offset)||0),p_sort:b.sort==='visits'?'visits':'paid',p_mode:b.mode==='full'?'full':'same'}));
  if(b.action==='export')return send(await exportDirect(actor,cleanMonth(b.month),b.cursor||null));
  if(b.action==='import')return send(await rpc('admin_import_v2',{...args,p_rows:b.rows,p_dry:b.dry_run!==false}));
  fail('不支援的操作');
 }catch(e){if(e.status===403&&e.message==='此帳號沒有管理權限')sessionCookies(res,'','');res.status(e.status||500).json({error:e.status?e.message:'暫時無法連線，請稍後重試或檢查服務設定',...(e.code?{code:e.code}:{})});}
}
