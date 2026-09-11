import {root,el,button,panel,status,api,setToken,loadConfig} from './core.js';
import {customerView} from './customer-ui.js';
let pending=null,generation=0,lastUpdated=0,hasCard=false;
function sdk(){return new Promise((resolve,reject)=>{if(window.liff)return resolve();const timer=setTimeout(()=>reject(Error('LINE 元件載入逾時，請檢查網路後重試。')),15000),s=document.createElement('script');s.src='https://static.line-scdn.net/liff/edge/2/sdk.js';s.onload=()=>{clearTimeout(timer);resolve();};s.onerror=()=>{clearTimeout(timer);reject(Error('LINE 元件載入失敗，請重新開啟。'));};document.head.append(s);});}
function loginAgain(){liff.logout();liff.login({redirectUri:location.origin+'/'});}
async function readPoints(data={}){if(!navigator.onLine)throw Error('目前沒有網路，連線後再更新點數。');const token=liff.getIDToken();if(!token){const e=Error('LINE 登入已失效，請重新登入。');e.status=401;throw e;}setToken(token);return api('me',data);}
function showError(e){status(e.status===401?'LINE 登入已失效，請重新登入。':e.message,true);const old=document.querySelector('.customer-retry');old?.remove();const box=el('div',undefined,'customer-retry');box.append(el('p',hasCard?'下方保留上次資料，尚未更新；結帳以店員查詢為準。':'暫時還不能讀取會員卡，請重試或把錯誤代碼提供給店家。'),button(e.status===401?'重新登入 LINE':'重試讀取',e.status===401?loginAgain:refresh,'secondary'));root.prepend(box);const time=document.querySelector('#balance-freshness');if(time){time.classList.add('stale');time.textContent='尚未更新 · '+new Date(lastUpdated).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'});}}
function refresh(){if(pending)return pending;pending=(async()=>{status('正在更新你的會員卡…');try{const d=await readPoints();const here=++generation;lastUpdated=Date.now();hasCard=true;root.replaceChildren(customerView(d,{refresh,updatedAt:new Date(lastUpdated),loadMore:async cursor=>{try{const next=await readPoints({before_day:cursor});return here===generation?next:null;}catch(e){showError(e);return null;}}}));status('會員卡已更新。');}catch(e){showError(e);}})().finally(()=>{pending=null;});return pending;}
try{
 const [c]=await Promise.all([loadConfig(),sdk()]);document.title=c.store+'｜我的點數補給站';
 if(!c.liffId)throw Error('會員服務尚未設定完成（CFG-LIFF），請聯絡店家。');await liff.init({liffId:c.liffId});
 if(!liff.isLoggedIn()){const login=panel('歡迎來到你的點數補給站');login.append(el('p','使用 LINE 登入，開啟專屬會員卡與點數補給紀錄。'),button('使用 LINE 登入',()=>liff.login({redirectUri:location.origin+'/'})));root.replaceChildren(login);status('登入後即可查看自己的會員資料。');}
 else await refresh();
}catch(e){status(e.message,true);root.replaceChildren(button('重新開啟',()=>location.reload(),'secondary'));}
window.addEventListener('offline',()=>{if(hasCard)showError(Error('目前沒有網路，顯示的是上次更新資料。'));});
window.addEventListener('online',()=>{if(hasCard)refresh();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&hasCard&&navigator.onLine&&Date.now()-lastUpdated>60000)refresh();});
