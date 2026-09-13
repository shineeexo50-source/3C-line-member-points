import {el,button,panel,api,status,table,dateText,download,money} from './core.js?v=535c9057dc25';
import {csvText} from './csv.js?v=535c9057dc25';
export async function operations(view,isCurrent){
 view.replaceChildren(el('p','OPERATIONS · 營運核對','eyebrow'),el('h1','點數與操作紀錄'));
 const controls=el('div',undefined,'row'),body=el('div');view.append(controls,body);
 let offset=0,sequence=0;
 async function reconcile(){const v=++sequence;status('正在核對交易與操作紀錄…');const d=await api('reconcile',{data:{offset}});if(!isCurrent()||v!==sequence)return;
 body.replaceChildren(el('h2','全部會員點數對帳'),el('p',`目前未使用 ${d.total_points.toLocaleString()} 點 · 對帳差異 ${d.difference_count} 人 · 負餘額 ${d.negative_count} 人`),el('p','以有效交易餘額核對操作紀錄的贈點、折抵與作廢回沖。差異不會自動修改；請查核原始交易。','muted'));
 body.append(table(['會員','累計贈點','累計折抵','可用點數','紀錄淨額','差異','明細'],d.rows.map(m=>[m.display_name,m.earned,m.redeemed,m.points,m.ledger_points,m.difference,button('點數流水',()=>ledger(m.id,m.display_name),'secondary')])));
 const pager=el('div',undefined,'row');if(offset)pager.append(button('上一頁',async()=>{offset-=50;await reconcile();},'secondary'));if(d.has_more)pager.append(button('下一頁',async()=>{offset+=50;await reconcile();},'secondary'));body.append(pager,el('p','核對時間：'+dateText(d.checked_at),'muted'));status('點數對帳完成。');}
 async function ledger(mid,name){const v=++sequence;body.replaceChildren(el('h2',name+' · 點數流水'),el('p','按實際入帳操作順序排列；歷史補登入帳日可能與消費日期不同。作廢會顯示回沖。','muted'));const list=el('div');body.append(list);let cursor=null;
 async function page(){const d=await api('ledger',{data:{member_id:mid,before:cursor}});if(!isCurrent()||v!==sequence)return;list.append(table(['操作時間','類型','贈點／回沖','折抵／退回','紀錄餘額','交易編號'],d.rows.map(x=>[dateText(x.created_at),x.action==='sale'?'消費':'作廢',x.earned,x.redeemed,x.balance,x.transaction_id])));if(!d.rows.length)list.append(el('p','尚無點數異動。','empty'));cursor=d.next;more.hidden=!cursor;}
 const more=button('載入較早異動',page,'secondary');body.append(more,button('返回對帳',reconcile,'secondary'));await page();}
 async function audit(){const v=++sequence;body.replaceChildren(el('h2','管理操作紀錄'));const list=el('div');body.append(list);let cursor=null;
 async function page(){const d=await api('audit',{data:{before:cursor}});if(!isCurrent()||v!==sequence)return;list.append(table(['時間','管理員','操作','會員','修改內容'],d.rows.map(x=>{const detail=el('details');detail.append(el('summary','查看前後內容'),el('pre',JSON.stringify({修改前:x.old_data,修改後:x.new_data},null,2)));return [dateText(x.created_at),x.email||x.actor||'—',({sale:'新增消費',void:'作廢',items:'更正品項',profile:'修改會員'})[x.action]||x.action,x.display_name||x.member_id,detail];})));if(!d.rows.length)list.append(el('p','目前沒有操作紀錄。','empty'));cursor=d.next;more.hidden=!cursor;}
 const more=button('載入較早紀錄',page,'secondary');body.append(more);await page();status('操作紀錄已載入。');}
 controls.append(button('點數對帳',()=>{offset=0;return reconcile();},'secondary'),button('操作紀錄',audit,'secondary'));await reconcile();
}
export async function backups(view,isCurrent){
 view.replaceChildren(el('p','BACKUP & RESTORE · 資料保護','eyebrow'),el('h1','備份與還原'));
 const save=panel('下載業務資料備份');save.append(el('p','包含會員、交易、客訂商品、店員選項、管理員授權清單與操作紀錄，附點數合計及檔案校驗碼。備份含個人資料，請保存在私人位置。'),el('p','這是業務資料備份；帳號密碼、LINE 設定、Vercel 環境變數及 Supabase Storage 不包含在內。大型資料請依手冊使用資料庫備份。','muted'),button('下載備份 JSON',async()=>{status('正在建立一致的資料快照…');const [{wrapBackup},p]=await Promise.all([import('./backup.js?v=535c9057dc25'),api('backup')]);const doc=await wrapBackup(p);download('會員業務備份_'+p.created_at.slice(0,10)+'.json',JSON.stringify(doc),'application/json');status('備份已交給瀏覽器下載，請確認檔案已保存。');}));view.append(save);
 const restore=panel('驗證備份與產生還原 SQL'),file=el('input');file.type='file';file.accept='.json,application/json';file.setAttribute('aria-label','業務備份 JSON');const result=el('div');let sequence=0;
 restore.append(el('p','僅對空的業務資料表還原；不會覆蓋既有資料。需先具備原管理員 Auth 帳號 UUID。先執行演練 SQL，通過後再使用正式還原 SQL。'),file,result);view.append(restore);
 file.onchange=async()=>{const seq=++sequence;result.replaceChildren();try{const f=file.files[0];if(!f)return;if(f.size>4000000)throw Error('檔案過大，請使用資料庫還原流程');const {readBackup,validatePayload,restoreSQL}=await import('./backup.js?v=535c9057dc25');const p=await readBackup(await f.text());if(!isCurrent()||seq!==sequence)return;const d=validatePayload(p);
 result.append(el('h2','檔案校驗通過'),el('p',`備份日期 ${dateText(p.created_at)}；會員 ${d.members} 位、交易 ${d.transactions} 筆、客訂 ${d.custom_orders||0} 筆、操作 ${d.audit} 筆、可用點數合計 ${d.points}。`),button('下載還原演練 SQL（結尾回滾）',()=>download('還原演練.sql',restoreSQL(p,true),'text/plain;charset=utf-8'),'secondary'),button('下載正式還原 SQL',()=>download('正式還原.sql',restoreSQL(p,false),'text/plain;charset=utf-8'),'secondary'),el('p','下載 SQL 不會更動資料庫。請在 Supabase SQL Editor 的新查詢執行；不要刪除正式資料來通過空表檢查。校驗碼驗證完整性，不代表檔案來源可信。','muted'));status('備份格式、校驗碼與點數合計已核對。');}catch(e){status(e.message,true);}};
}
