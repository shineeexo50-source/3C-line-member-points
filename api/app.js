const timeout=()=>AbortSignal.timeout(20000);
function fail(message,status=400){const e=new Error(message);e.status=status;throw e;}
async function rpc(name,body){
 const key=process.env.SUPABASE_SECRET_KEY,headers={apikey:key,'Content-Type':'application/json'};
 if(key?.startsWith('eyJ'))headers.Authorization=`Bearer ${key}`;
 const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify(body),signal:timeout()});
 const d=await r.json().catch(()=>null);
 if(!r.ok){
  if(d?.code==='42501')fail('此帳號沒有管理權限',403);
  if(d?.code==='PGRST202'||d?.code==='42883')fail('請先依序執行 sql/04_upgrade_v2.sql 與 sql/06_upgrade_v3.sql，再重新整理',503);
  if(d?.code==='P0001')fail(d.message);
  if(['22P02','22007','22008','22003','23502','23514'].includes(d?.code))fail('資料格式不正確，請檢查金額、日期與會員編號');
  if(d?.code==='23505')fail('訂單編號已使用，請重新查詢確認交易');
  fail('資料服務失敗，請檢查 Supabase 設定或稍後重試',502);
 }return d;
}
async function verifiedLine(token){
 if(!token)fail('請先使用 LINE 登入',401);
 const r=await fetch('https://api.line.me/oauth2/v2.1/verify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({id_token:token,client_id:process.env.LINE_CHANNEL_ID}),signal:timeout()});
 const d=await r.json();if(!r.ok||!d.sub)fail('LINE 登入已失效，請重新開啟會員頁',401);return d;
}
async function verifiedUser(token){
 if(!token)fail('請先登入管理端',401);
 const r=await fetch(process.env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${token}`},signal:timeout()});
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
 const r=await fetch(process.env.SUPABASE_URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:jar[REFRESH_COOKIE]}),signal:timeout()});
 const d=await r.json();
 if(!r.ok||!d.access_token||!d.refresh_token){
  if(r.status>=500||r.status===429)fail('登入服務暫時忙碌，請稍後重試',503);
  sessionCookies(res,'','');fail('登入已失效，請重新登入',401);
 }
 actor=await verifiedUser(d.access_token);await rpc('require_admin_v2',{p_actor:actor});sessionCookies(res,d.access_token,d.refresh_token);return actor;
}
export default async function handler(req,res){
 const began=performance.now();res.setHeader('Cache-Control','no-store');
 const send=d=>{res.setHeader('Server-Timing',`app;dur=${Math.round(performance.now()-began)}`);return res.json(d);};
 try{
  if(req.method!=='POST')return res.status(405).json({error:'請使用 POST'});
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
   const r=await fetch(process.env.SUPABASE_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({email:b.email,password:b.password}),signal:timeout()});
   const d=await r.json();if(!r.ok)fail('帳號或密碼錯誤，或嘗試次數過多',401);
   const actor=await verifiedUser(d.access_token);await rpc('require_admin_v2',{p_actor:actor});
   if(!d.refresh_token)fail('登入服務未回傳完整憑證',502);
   sessionCookies(res,d.access_token,d.refresh_token);return send({authenticated:true});
  }
  if(b.action==='session'){await restoreSession(req,res);return send({authenticated:true});}
  if(b.action==='logout'){
   // Always remove this browser's credentials. Revocation is best effort if Auth is offline.
   sessionCookies(res,'','');let revoked=false;
   if(jar[ACCESS_COOKIE])try{const r=await fetch(process.env.SUPABASE_URL+'/auth/v1/logout?scope=local',{method:'POST',headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${jar[ACCESS_COOKIE]}`},signal:timeout()});revoked=r.ok;}catch{}
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
  if(['health','audit','ledger','reconcile','backup'].includes(b.action))return send(await rpc('admin_operations_v3',{...args,p_action:b.action,p_data:b.data||{}}));
  if(b.action==='search')return send(await rpc('admin_members_v2',{...args,p_query:String(b.query||''),p_offset:Math.max(0,parseInt(b.offset)||0)}));
  if(b.action==='detail')return send(await rpc('admin_detail_v2',{...args,p_member:b.member_id,p_cursor:b.cursor||null,p_summary:!b.cursor}));
  if(['sale','profile','void','items'].includes(b.action))return send(await rpc('admin_write_v2',{...args,p_action:b.action,p_data:b.data||{}}));
  if(b.action==='report')return send(await rpc('admin_report_v3',{...args,p_month:b.month,p_mode:b.mode==='full'?'full':'same'}));
  if(b.action==='compare')return send(await rpc('admin_compare_v3',{...args,p_month:b.month,p_offset:Math.max(0,parseInt(b.offset)||0),p_sort:b.sort==='visits'?'visits':'paid',p_mode:b.mode==='full'?'full':'same'}));
  if(b.action==='export')return send(await rpc('admin_export_v2',{...args,p_month:b.month,p_cursor:b.cursor||null}));
  if(b.action==='import')return send(await rpc('admin_import_v2',{...args,p_rows:b.rows,p_dry:b.dry_run!==false}));
  fail('不支援的操作');
 }catch(e){if(e.status===403&&e.message==='此帳號沒有管理權限')sessionCookies(res,'','');res.status(e.status||500).json({error:e.status?e.message:'暫時無法連線，請稍後重試或檢查服務設定'});}
}
