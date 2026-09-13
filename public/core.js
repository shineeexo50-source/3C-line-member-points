export const $=s=>document.querySelector(s);
export const root=$('#app');
export let token='';export function setToken(t){token=t;}
const THEME_KEY='member-ui-theme.v1';
export function applyTheme(mode='system'){const valid=['system','light','dark'].includes(mode)?mode:'system';document.documentElement.dataset.theme=valid;try{localStorage.setItem(THEME_KEY,valid);}catch{}const meta=document.querySelector('meta[name=theme-color]');if(meta){const dark=valid==='dark'||(valid==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);meta.content=dark?'#101319':'#eef4f8';}return valid;}
export function initTheme(){let saved='system';try{saved=localStorage.getItem(THEME_KEY)||'system';}catch{}const mode=applyTheme(saved);const mq=matchMedia('(prefers-color-scheme: dark)');mq.addEventListener?.('change',()=>{if(document.documentElement.dataset.theme==='system')applyTheme('system');});return mode;}
export function themeButton(){const b=button('',()=>{const now=document.documentElement.dataset.theme||'system',next=now==='system'?'light':now==='light'?'dark':'system';applyTheme(next);paint();status(next==='dark'?'已切換深色模式':next==='light'?'已切換淺色模式':'已改為跟隨系統外觀');},'theme-toggle secondary');const paint=()=>{const m=document.documentElement.dataset.theme||'system';b.textContent=m==='dark'?'☾ 深色':m==='light'?'☀ 淺色':'◐ 自動';b.setAttribute('aria-label','切換頁面外觀，目前：'+(m==='dark'?'深色':m==='light'?'淺色':'跟隨系統'));};paint();return b;}
export const money=n=>'NT$ '+Number(n||0).toLocaleString('zh-TW',{maximumFractionDigits:2});
export const dateText=d=>new Date(d).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
export function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
export function status(message,error=false){const box=$('#status');box.textContent=message;box.className=error?'error':'';}
let refreshInFlight=null,signingOut=false;
const READ_ACTIONS=new Set(['session','me','health','audit','ledger','reconcile','backup','search','detail','report','compare','export']);
function retrySafe(action,data){if(READ_ACTIONS.has(action))return true;const op=String(data?.data?.op||'');return (action==='custom_orders'&&['list','global','staff_list'].includes(op))||(action==='catalog'&&op==='list');}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function requestOnce(action,data){const r=await fetch('/api/app',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Member-App':'1',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({action,...data}),signal:AbortSignal.timeout(45000)});let d;try{d=await r.json();}catch{const e=Error('伺服器回應異常，請確認部署完成');e.status=r.status||502;throw e;}if(!r.ok){const e=Error(d.error||'連線失敗');e.status=r.status;throw e;}return d;}
async function request(action,data){const tries=retrySafe(action,data)?2:1;let last;for(let i=0;i<tries;i++){try{return await requestOnce(action,data);}catch(e){last=e;const retryable=!e.status||[429,502,503,504].includes(e.status);if(i+1>=tries||!retryable)throw e;await wait(260+Math.random()*240);}}throw last;}
export async function api(action,data={}){
 if(action==='login')signingOut=false;
 if(action==='logout'){signingOut=true;if(refreshInFlight)await refreshInFlight.catch(()=>{});try{return await request(action,data);}catch(e){signingOut=false;throw e;}}
 try{return await request(action,data);}catch(e){
  const isAdmin=location.pathname.includes('admin');
  if(e.status!==401||!isAdmin||signingOut||['login','session','logout'].includes(action))throw e;
  // All concurrent requests in this page share one refresh, then retry once.
  if(!refreshInFlight)refreshInFlight=request('session',{}).finally(()=>{refreshInFlight=null;});
  try{await refreshInFlight;}catch(err){if(err.status===401||err.status===403)window.dispatchEvent(new Event('admin-session-ended'));throw err;}
  try{return await request(action,data);}catch(err){if(err.status===401)window.dispatchEvent(new Event('admin-session-ended'));throw err;}
 }
}

export function button(text,fn,cls=''){const b=el('button',text,cls);b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){status(e.message,true);}finally{b.disabled=false;}};return b;}
export function field(form,label,name,type='text',value='',required=false){const wrap=el('div',undefined,'field'),l=el('label',label),i=el(type==='textarea'?'textarea':'input');i.id=name;i.name=name;if(type!=='textarea')i.type=type;i.value=value??'';i.required=required;l.htmlFor=name;wrap.append(l,i);form.append(wrap);return i;}
export function submit(form,text,fn){const b=el('button',text);b.type='submit';form.append(b);form.onsubmit=async e=>{e.preventDefault();b.disabled=true;try{await fn(Object.fromEntries(new FormData(form)));}catch(err){status(err.message,true);}finally{b.disabled=false;}};return b;}
export function panel(title){const box=el('section',undefined,'card');if(title)box.append(el('h2',title));return box;}
export function table(headers,rows){const wrap=el('div',undefined,'tablewrap'),t=el('table'),thead=el('thead'),head=el('tr'),tbody=el('tbody');for(const h of headers){const th=el('th',h);th.scope='col';head.append(th);}thead.append(head);for(const row of rows){const tr=el('tr');for(const value of row){const td=el('td');td.dataset.label=headers[tr.children.length];if(value instanceof Node)td.append(value);else td.textContent=String(value??'');tr.append(td);}tbody.append(tr);}t.append(thead,tbody);wrap.append(t);return wrap;}
export function summary(d,cute=false){const box=el('section',undefined,cute?'card membership':'card member-summary');box.append(el('p',cute?'MY LITTLE REWARDS · 我的會員卡':'MEMBER · 會員資訊','eyebrow'),el('h1',d.member.display_name));const stats=el('div',undefined,'stats');for(const [title,value] of [['可用點數',Number(d.points).toLocaleString()+' 點'],['累計實付',money(d.total)],['累計消費',d.visits+' 次']]){const one=el('div');one.append(el('span',title,'muted'),el('strong',value,'stat-value'));stats.append(one);}box.append(stats,el('p','每 1 點可折抵 1 元，下次結帳就能使用。','muted'));const id=el('div',undefined,'member-code');id.append(el('span','會員編號 '+d.member.id,'code'),button('複製編號',async()=>{await navigator.clipboard.writeText(d.member.id);status('會員編號已複製。');},'small secondary'));box.append(id);return box;}
export function itemText(items){return items?.length?items.map(i=>`${i.name} × ${i.qty}（單價 ${money(i.price)}）`).join('；'):'舊交易未填購買項目';}
export function download(name,text,type='text/csv;charset=utf-8'){const url=URL.createObjectURL(new Blob([text],{type})),a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
let configPromise;export function loadConfig(){if(!configPromise)configPromise=fetchConfig().catch(e=>{configPromise=null;throw e;});return configPromise;}
async function fetchConfig(){const r=await fetch('/config.json',{cache:'no-cache'});if(!r.ok)throw Error('網站設定尚未建立，請重新部署');const c=await r.json();$('#brand').textContent=c.store;$('#contact').textContent=[c.business,c.contact].filter(Boolean).join(' · ');return c;}
export function taipeiMonth(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit'}).format(new Date());}
export function taipeiNow(){return new Date(Date.now()+8*3600000).toISOString().slice(0,16);}
