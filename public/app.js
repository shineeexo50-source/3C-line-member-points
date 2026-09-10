import {root,el,button,panel,summary,status,api,setToken,loadConfig} from './core.js';
function sdk(){return new Promise((resolve,reject)=>{if(window.liff)return resolve();const s=document.createElement('script');s.src='https://static.line-scdn.net/liff/edge/2/sdk.js';s.onload=resolve;s.onerror=()=>reject(Error('LINE 元件載入失敗，請重新整理'));document.head.append(s);});}
async function refresh(){
 status('正在更新你的會員卡…');const d=await api('me');
 const top=el('div',undefined,'row between');top.append(el('p','小小點數，累積大大開心 ♡','intro'),button('更新點數',refresh,'secondary'));
 const gains=panel('點數小日記 ♡'),list=el('div',undefined,'point-days');
 const add=days=>days.forEach(x=>{const row=el('div',undefined,'point-day');row.append(el('span',x.day.replaceAll('-',' / ')),el('strong','＋'+Number(x.earned).toLocaleString()+' 點'));list.append(row);});add(d.point_days);
 if(!d.point_days.length)list.append(el('p','還沒有獲點紀錄，下次購物後再來看看 ♡','muted'));
 gains.append(el('p','同一天獲得的點數合併顯示。只列有效回饋；已使用的點數會反映在可用餘額。','muted'),list);
 let cursor=d.next_day;const more=button('看看更早的獲點',async()=>{const next=await api('me',{before_day:cursor});add(next.point_days);cursor=next.next_day;if(!cursor)more.remove();status('已載入較早的獲點紀錄。');},'secondary');if(cursor)gains.append(more);
 const tip=panel('下次見面，把點數帶上 ♡');tip.append(el('p','結帳時出示會員編號，請店員協助使用點數。'),el('p','如需核對購買內容，請透過官方 LINE 聯絡店家。','muted'));
 root.replaceChildren(top,summary(d,true),gains,tip);status('已更新 · '+new Date().toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'}));
}
try{
 const [c]=await Promise.all([loadConfig(),sdk()]);document.title=c.store+'｜我的點數';
 if(!c.liffId)throw Error('請先由店家設定 LIFF_ID 並重新部署。');await liff.init({liffId:c.liffId});
 if(!liff.isLoggedIn()){
  const login=panel('歡迎來到你的點數小天地 ♡');login.append(el('p','用 LINE 登入，就能查看累計消費與可用點數。'),button('使用 LINE 登入',()=>liff.login({redirectUri:location.origin+'/'})));root.replaceChildren(login);status('登入後建立你的專屬會員卡。');
 }else{const id=liff.getIDToken();if(!id)throw Error('請確認 LINE LIFF 已開啟 openid 權限');setToken(id);await refresh();}
}catch(e){status(e.message,true);root.replaceChildren(button('重新開啟',()=>location.reload(),'secondary'));}
