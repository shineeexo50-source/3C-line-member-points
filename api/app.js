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
 if(actor){await rpc('require_admin_v2',{p_actor:actor});return actor;}
 if(!jar[REFRESH_COOKIE]){sessionCookies(res,'','');fail('請先登入管理端',401);}
 const r=await fetch((process.env.SUPABASE_URL||'').trim().replace(/\/$/,'')+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:(process.env.SUPABASE_PUBLISHABLE_KEY||'').trim(),'Content-Type':'application/json'},body:JSON.stringify({refresh_token:jar[REFRESH_COOKIE]}),signal:timeout()});
 const d=await r.json();
 if(!r.ok||!d.access_token||!d.refresh_token){
  if(r.status>=500||r.status===429)fail('登入服務暫時忙碌，請稍後重試',503);
  sessionCookies(res,'','');fail('登入已失效，請重新登入',401);
 }
 actor=await verifiedUser(d.access_token);await rpc('require_admin_v2',{p_actor:actor});sessionCookies(res,d.access_token,d.refresh_token);return actor;
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
   const actor=await verifiedUser(d.access_token);await rpc('require_admin_v2',{p_actor:actor});
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
  if(b.action==='backup')return send(await rpc('admin_backup_v39',args));
  if(b.action==='health')return send(await rpc('admin_health_v39',args));
  if(['audit','ledger','reconcile'].includes(b.action))return send(await rpc('admin_operations_v3',{...args,p_action:b.action,p_data:b.data||{}}));
  if(b.action==='search'){const q=String(b.query||'').trim();if(q.length>200)fail('搜尋內容過長');return send(await membersDirect(actor,q,Math.max(0,parseInt(b.offset)||0)));}
  if(b.action==='detail'){const mid=cleanMemberId(b.member_id),cursor=b.cursor||null;return send(await detailDirect(actor,mid,cursor,!cursor));}
  if(b.action==='custom_orders')return send(await rpc('admin_custom_orders_v39',{...args,p_action:String(b.data?.op||''),p_data:b.data||{}}));
  if(b.action==='notify_order'){
   const data=b.data||{},target=await rpc('admin_custom_orders_v39',{...args,p_action:'notify_target',p_data:data});
   const access=(process.env.LINE_CHANNEL_ACCESS_TOKEN||'').trim();if(!access)fail('尚未設定 LINE Messaging API。請在環境變數加入 LINE_CHANNEL_ACCESS_TOKEN。',503,'LINE-MSG-CFG');
   const item=String(target?.order?.product_name||'客訂商品'),name=String(target?.display_name||'會員'),store=process.env.STORE_NAME||'門市';
   const text=`${name}您好，您在 ${store} 客訂的「${item}」已有最新進度，歡迎與我們聯繫或到店確認，謝謝您。`;
   let r;try{r=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},body:JSON.stringify({to:target.line_id,messages:[{type:'text',text:text.slice(0,5000)}]}),signal:timeout()});}catch{fail('LINE 通知連線逾時，尚未標記為已通知',503,'LINE-MSG-NET');}
   if(!r.ok){const err=await r.json().catch(()=>null);fail(err?.message?`LINE 通知失敗：${err.message}`:'LINE 通知失敗，尚未標記為已通知',502,'LINE-MSG');}
   const marked=await rpc('admin_custom_orders_v39',{...args,p_action:'notify_mark',p_data:data});return send({sent:true,order:marked});
  }
  if(['sale','profile','void','items'].includes(b.action))return send(await rpc('admin_write_v2',{...args,p_action:b.action,p_data:b.data||{}}));
  if(b.action==='report')return send(await rpc('admin_report_v3',{...args,p_month:cleanMonth(b.month),p_mode:b.mode==='full'?'full':'same'}));
  if(b.action==='compare')return send(await rpc('admin_compare_v3',{...args,p_month:cleanMonth(b.month),p_offset:Math.max(0,parseInt(b.offset)||0),p_sort:b.sort==='visits'?'visits':'paid',p_mode:b.mode==='full'?'full':'same'}));
  if(b.action==='export')return send(await rpc('admin_export_v2',{...args,p_month:cleanMonth(b.month),p_cursor:b.cursor||null}));
  if(b.action==='import')return send(await rpc('admin_import_v2',{...args,p_rows:b.rows,p_dry:b.dry_run!==false}));
  fail('不支援的操作');
 }catch(e){if(e.status===403&&e.message==='此帳號沒有管理權限')sessionCookies(res,'','');res.status(e.status||500).json({error:e.status?e.message:'暫時無法連線，請稍後重試或檢查服務設定',...(e.code?{code:e.code}:{})});}
}
