import {el,button,panel,money,dateText,status} from './core.js?v=d0b5d1b3e54d';
function memberQrPayload(id){
 try{if(location.protocol==='http:'||location.protocol==='https:')return new URL(`/admin.html?member=${encodeURIComponent(id)}&source=qr`,location.origin).href;}catch{}
 return String(id);
}
export async function showMember(d,updatedAt){
 const {makeQrSvg}=await import('./qr-svg.js?v=d0b5d1b3e54d');
 const dialog=el('dialog',undefined,'member-pass wallet-pass-dialog ios27-pass-dialog');
 const shell=el('section',undefined,'wallet-pass ios27-wallet-pass');
 const top=el('div',undefined,'wallet-pass-top');
 const brand=el('div',undefined,'wallet-brand');brand.append(el('span','3C','wallet-brand-mark'),el('div',undefined,'wallet-brand-copy'));
 brand.lastChild.append(el('strong','MEMBER CLUB'),el('span','數位會員卡'));
 const close=button('×',()=>dialog.close(),'wallet-close');close.setAttribute('aria-label','關閉會員卡');top.append(brand,close);shell.append(top);
 const identity=el('div',undefined,'wallet-identity');identity.append(el('p','結帳會員識別','wallet-kicker'),el('h2',d.member.display_name),el('p','請店員使用手機相機掃描 QR Code；登入管理端後會直接搜尋並開啟此會員。','wallet-guide'));shell.append(identity);
 const body=el('div',undefined,'wallet-pass-body qr-only-pass');
 const qrWrap=el('div',undefined,'wallet-qr-wrap wallet-qr-primary');qrWrap.append(makeQrSvg(memberQrPayload(d.member.id),{size:260,margin:5}),el('strong','掃描搜尋會員','wallet-qr-title'),el('span','QR MEMBER LOOKUP','wallet-qr-label'),el('small','店員 iPhone 相機 → 掃描 → 開啟管理端','wallet-qr-help'));
 const info=el('div',undefined,'wallet-pass-info');
 const points=el('div',undefined,'wallet-points');points.append(el('span','目前可用點數'),el('strong',Number(d.points).toLocaleString()+' 點'),el('small','可折抵 '+money(d.points)));
 const idBox=el('div',undefined,'wallet-member-id');idBox.append(el('span','會員編號'),el('strong',d.member.id));
 const copy=button('複製會員編號',()=>copyMember(d.member.id),'wallet-copy');info.append(points,idBox,copy);
 body.append(qrWrap,info);shell.append(body);
 const foot=el('div',undefined,'wallet-pass-foot');foot.append(el('span','1 點 = NT$1'),el('span','更新 '+dateText(updatedAt)));shell.append(foot);
 const note=el('p','QR 只負責帶店員進入管理端會員搜尋；會員資料仍受管理員登入權限保護。','wallet-pass-note');
 dialog.append(shell,note);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();close.focus();
}
async function copyMember(id){try{await navigator.clipboard.writeText(id);status('會員編號已複製，結帳時提供給店員即可。');}catch{const dialog=el('dialog',undefined,'member-pass'),input=el('textarea');input.value=id;input.readOnly=true;dialog.append(el('h2','長按或全選複製會員編號'),input,button('關閉',()=>dialog.close(),'secondary'));dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();input.focus();input.select();}}
export function customerView(d,{refresh,loadMore,updatedAt=new Date(),demo=false}={}){
 const page=el('div',undefined,'customer-home');
 const hero=el('div',undefined,'customer-hero'),photo=el('img');photo.src='/iphone18-hero.webp';photo.alt='銀色旗艦手機寫實展示情境';photo.width=1280;photo.height=853;photo.className='hero-photo';photo.decoding='async';photo.fetchPriority='high';photo.onerror=()=>{photo.hidden=true;};hero.append(photo);page.append(hero);
 const greeting=el('div',undefined,'welcome-row'),words=el('div');words.append(el('p','YOUR EVERYDAY REWARDS','eyebrow'),el('h1','嗨，'+d.member.display_name+'！'),el('p','點數、折抵與會員卡，一眼就看懂。','welcome-copy'));greeting.append(words,el('span','專屬會員','member-badge'));hero.append(greeting);
 const card=el('section',undefined,'rewards-card');card.setAttribute('aria-label','我的點數會員卡');
 const top=el('div',undefined,'reward-top');top.append(el('span','我的點數補給站','reward-label'),el('span','MEMBER CLUB','card-wordmark'));card.append(top);
 const value=el('div',undefined,'reward-value');value.append(el('strong',Number(d.points).toLocaleString()),el('span','點'));card.append(value,el('p','可折抵 '+money(d.points),'reward-cash'));
 const foot=el('div',undefined,'reward-bottom');foot.append(el('span','1 點 = NT$1'),el('span','好配件，好回饋'));card.append(foot);hero.append(card);
 const actions=el('div',undefined,'member-actions');actions.append(button('結帳出示會員卡',()=>showMember(d,updatedAt),'primary-pass'),button('↻ 更新',refresh||(()=>{}),'refresh-points'));page.append(actions);
 const freshness=el('p',(demo?'示範資料 · ':'')+'更新於 '+dateText(updatedAt),'freshness');freshness.id='balance-freshness';page.append(freshness);
 const stats=el('section',undefined,'shopping-stats');for(const [label,value] of [['累計實付消費',money(d.total)],['累計消費次數',Number(d.visits).toLocaleString()+' 次']]){const box=el('div');box.append(el('span',label),el('strong',value));stats.append(box);}page.append(stats);
 const diary=panel(),diaryHead=el('div',undefined,'diary-head');diaryHead.append(el('h2','最近點數紀錄'),el('span','獲得與使用一眼辨識'));diary.append(diaryHead);
 const list=el('div',undefined,'point-days');const appendDays=days=>days.forEach(x=>{const row=el('div',undefined,'point-day'),left=el('div',undefined,'point-day-info');left.append(el('span','＋','day-icon'),el('span',x.day.replaceAll('-',' / ')));row.append(left,el('strong','＋'+Number(x.earned).toLocaleString()+' 點'));list.append(row);});appendDays(d.point_days||[]);
 if(!d.point_days?.length)list.append(el('p','你的第一份回饋，等下次購物來收藏 ♡','empty'));
 diary.append(list);if(d.next_day&&loadMore){let cursor=d.next_day;const more=button('看看更早的獲點',async()=>{const next=await loadMore(cursor);if(!next)return;appendDays(next.point_days);cursor=next.next_day;if(!cursor)more.remove();},'diary-more');diary.append(more);}
 diary.append(el('p','同日回饋合併顯示；已作廢回饋不計入。使用點數後，可用餘額會減少。','diary-note'));page.append(diary);
 const help=el('details',undefined,'reward-help');help.append(el('summary','點數怎麼累積、怎麼用？'));help.append(el('p','每筆實付每滿 NT$100 贈 10 點，1 點可折 NT$1。未滿百元的部分不跨筆累積；折抵後的實付金額才計算回饋。'),el('p','例如：商品 NT$500，使用 100 點，實付 NT$400，再獲得 40 點。結帳時按「出示會員卡」，請店員協助折抵。'),el('p','需要核對購買內容？請透過官方 LINE 聯絡店家。'));page.append(help);
 return page;
}
