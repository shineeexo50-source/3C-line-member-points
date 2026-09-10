export const $=s=>document.querySelector(s);
export const root=$('#app');
export let token='';export function setToken(t){token=t;}
export const money=n=>'NT$ '+Number(n||0).toLocaleString('zh-TW',{maximumFractionDigits:2});
export const dateText=d=>new Date(d).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
export function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
export function status(message,error=false){const box=$('#status');box.textContent=message;box.className=error?'error':'';}
let refreshInFlight=null,signingOut=false;
async function request(action,data){const r=await fetch('/api/app',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Member-App':'1',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({action,...data}),signal:AbortSignal.timeout(60000)});let d;try{d=await r.json();}catch{throw Error('伺服器回應異常，請確認部署完成');}if(!r.ok){const e=Error(d.error||'連線失敗');e.status=r.status;throw e;}return d;}
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
