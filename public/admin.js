import {$,root,el,button,panel,summary,status,api,setToken,loadConfig,field,submit,table,money,dateText,itemText,download,taipeiMonth,taipeiNow} from './core.js';
import {csvText,parseImport,importHeaders} from './csv.js';
let view,epoch=0,month=taipeiMonth(),selected=null,memberQuery='',memberOffset=0,compareOffset=0,compareSort='paid';
let inputSequence=0,comparisonMode='same';
const signed=n=>(Number(n)>0?'+':'')+Number(n||0).toLocaleString('zh-TW',{maximumFractionDigits:2});
function login(){epoch++;setToken('');root.replaceChildren();const form=el('form',undefined,'card login');form.append(el('p','MEMBER STUDIO','eyebrow'),el('h1','店家管理端'),el('p','查看營運數據，照顧每一位回訪的客人。','muted'));field(form,'管理員 Email','email','email','',true).autocomplete='username';field(form,'密碼','password','password','',true).autocomplete='current-password';submit(form,'登入管理端',async data=>{await api('login',data);setToken('');form.reset();shell();await overview();});root.append(form);status('使用已授權的管理員帳號登入。');}
function shell(){root.replaceChildren();const nav=el('nav',undefined,'admin-tabs');nav.setAttribute('aria-label','管理功能');nav.append(button('月度分析',overview),button('會員與交易',members),button('試算表匯入',imports),button('點數與紀錄',()=>extraView('operations')),button('備份與還原',()=>extraView('backups')),button('登出',logout,'secondary'));view=el('div');root.append(nav,view);}
async function extraView(name){const current=++epoch;selected=null;view.replaceChildren(el('p','載入中…','muted'));const module=await import('./operations.js');if(epoch===current)await module[name](view,()=>epoch===current);}
function monthControl(onChange){const row=el('div',undefined,'row'),label=el('label','分析月份'),input=el('input');input.type='month';input.value=month;input.setAttribute('aria-label','分析月份');input.className='month-input';const mode=el('select');mode.setAttribute('aria-label','比較期間');for(const [value,text] of [['same','本月截至今日／上月同期'],['full','完整月份比較']]){const o=el('option',text);o.value=value;mode.append(o);}mode.value=comparisonMode;row.append(label,input,mode,button('更新報表',async()=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.value))throw Error('請選擇月份');month=input.value;comparisonMode=mode.value;compareOffset=0;await onChange();},'secondary'));return row;}
async function overview(){
 const thisEpoch=++epoch;selected=null;view.replaceChildren(el('h1','這個月，客人帶來多少回訪？'),monthControl(overview),el('p','載入月度分析…','muted'));status('正在計算月度報表…');
 const [report,comparison,charts]=await Promise.all([api('report',{month,mode:comparisonMode}),api('compare',{month,offset:0,sort:compareSort,mode:comparisonMode}),import('./charts.js')]);if(thisEpoch!==epoch)return;
 const head=el('div',undefined,'row between');head.append(monthControl(overview),button('匯出本月交易 CSV',()=>exportMonth(month),'secondary'));
 view.replaceChildren(el('p','MONTHLY OVERVIEW · 月度分析','eyebrow'),el('h1',month+' 營運總覽'),head,el('p',`台灣時間：${dateText(report.start_at).split(' ')[0]} ～ ${dateText(new Date(new Date(report.end_at)-1)).split(' ')[0]}；比較 ${dateText(report.previous_at).split(' ')[0]} ～ ${dateText(new Date(new Date(report.previous_end)-1)).split(' ')[0]}。今日資料持續增加；歷史月份按整月比較。`,'muted'));
 const metrics=el('div',undefined,'metric-grid');
 for(const [key,label,unit] of [['paid','實付消費金額','元'],['earned','發出回饋金額','元'],['redeemed','實際折抵金額','元'],['visits','消費次數','次'],['customers','消費會員數','人'],['average','平均每筆實付','元']]){
  const now=Number(report.current[key]),before=Number(report.previous[key]),diff=now-before,card=el('section',undefined,'metric');card.append(el('span',label,'muted'),el('strong',unit==='元'?money(now):now.toLocaleString()+' '+unit,'metric-value'));
  const percent=before===0?'比較期為 0，不計百分比':signed(diff/before*100)+'%';card.append(el('span',`較比較期 ${signed(diff)} ${unit} · ${percent}`,'metric-change'));metrics.append(card);
 }
 view.append(metrics);const grid=el('div',undefined,'chart-grid'),line=panel('每日趨勢'),selector=el('select');selector.setAttribute('aria-label','趨勢圖指標');const metricNames={paid:'實付消費金額（元）',earned:'發出回饋金額（元）',redeemed:'實際折抵金額（元）',visits:'消費次數（次）'};for(const [key,name] of Object.entries(metricNames)){const o=el('option',name);o.value=key;selector.append(o);}const lineBody=el('div');const renderLine=()=>lineBody.replaceChildren(charts.lineChart(report.days,selector.value,metricNames[selector.value]));selector.onchange=renderLine;line.append(selector,lineBody);renderLine();const pie=panel('本月客戶消費頻率');pie.append(charts.donutChart(report.frequency),el('p','圓餅圖以「會員人數」分類；每位會員只計入一個消費頻率區間。','muted'));grid.append(line,pie);view.append(grid);
 const products=panel('商品排行與回訪');products.append(el('p',`本期首次消費 ${report.customer_types.new} 人 · 過往曾消費 ${report.customer_types.returning} 人`),el('p','新客依系統最早有效交易判斷；排行依品名合併，列出數量前 20 名。商品金額為折抵前小計，不是實付或利潤；未填品項的舊交易不計入商品排行。','muted'));if(report.products.length)products.append(table(['商品','數量','折抵前金額'],report.products.map(x=>[x.name,x.quantity,money(x.gross)])));else products.append(el('p','本期尚無可分析的購買項目。','empty'));view.append(products);
 const compareBox=panel('客戶兩期比較（依上方期間）');const sort=el('select');sort.setAttribute('aria-label','客戶排序');for(const [value,label] of [['paid','依本月消費金額排序'],['visits','依本月消費次數排序']]){const o=el('option',label);o.value=value;sort.append(o);}sort.value=compareSort;const body=el('div');let fetchVersion=0;compareOffset=0;
 async function loadCompare(){const version=++fetchVersion;const data=await api('compare',{month,offset:compareOffset,sort:compareSort,mode:comparisonMode});if(epoch!==thisEpoch||version!==fetchVersion)return;renderCompare(data);}
 function renderCompare(data){body.replaceChildren();if(!data.rows.length)body.append(el('p','本月及上月尚無有效消費。','empty'));else body.append(table(['客戶','本期金額','比較期金額','金額差額','本期次數','比較期次數','次數差額','本期回饋'],data.rows.map(m=>[button(m.display_name,async()=>{await members();await openMember(m.id);},'text-button'),money(m.paid),money(m.previous_paid),signed(m.paid_diff),m.visits,m.previous_visits,signed(m.visits_diff),money(m.earned)])));
 const pager=el('div',undefined,'row');pager.append(el('span',`第 ${compareOffset+1} 筆起`,'muted'));if(compareOffset)pager.append(button('上一頁',async()=>{compareOffset-=50;await loadCompare();},'secondary'));if(data.has_more)pager.append(button('下一頁',async()=>{compareOffset+=50;await loadCompare();},'secondary'));body.append(pager);}
 sort.onchange=async()=>{compareSort=sort.value;compareOffset=0;try{await loadCompare();}catch(e){status(e.message,true);}};compareBox.append(sort,button('匯出客戶比較 CSV',()=>exportComparison(month),'secondary'),body);renderCompare(comparison);view.append(compareBox);status('報表已更新。回饋金額以 1 點＝1 元呈現。');
}
async function exportComparison(targetMonth){
 const exportMode=comparisonMode;
 status('正在匯出客戶比較…');let offset=0,rows=[],more;
 do{const d=await api('compare',{month:targetMonth,offset,sort:'paid',mode:exportMode});rows.push(...d.rows);more=d.has_more;offset+=50;if(offset>100000)throw Error('資料過多，請使用資料庫匯出');}while(more);
 download(`客戶月度比較_${targetMonth}_${exportMode}.csv`,csvText(['會員編號','姓名','電話','本期實付','比較期實付','金額差額','本期次數','比較期次數','次數差額','本期回饋'],rows.map(x=>[x.id,x.display_name,x.phone,x.paid,x.previous_paid,x.paid_diff,x.visits,x.previous_visits,x.visits_diff,x.earned])));status(`已匯出 ${rows.length} 位會員的月度比較。`);
}
async function exportMonth(targetMonth){
 status('正在準備完整月份交易…');let cursor=null,rows=[];
 do{const d=await api('export',{month:targetMonth,cursor});rows.push(...d.rows);cursor=d.next;status(`已讀取 ${rows.length} 筆交易…`);if(rows.length>100000)throw Error('單月資料超過瀏覽器匯出上限，請使用資料庫匯出');}while(cursor);
 download(`交易報表_${targetMonth}.csv`,csvText(['交易編號','外部訂單編號','會員編號','姓名','電話','消費時間（台灣）','購買項目','原金額','折抵點數','實付金額','回饋點數','狀態','店內備註','作廢原因'],rows.map(t=>[t.id,t.external_id||'',t.member_id,t.display_name,t.phone,dateText(t.occurred_at),itemText(t.items),t.gross,t.redeemed,t.paid,t.earned,t.voided_at?'已作廢':'有效',t.note,t.void_reason||''])));status(`已匯出 ${rows.length} 筆（包含作廢紀錄）；統計時請篩選「有效」。`);
}
async function members(){
 const thisEpoch=++epoch;selected=null;view.replaceChildren(el('p','MEMBERS · 會員與交易','eyebrow'),el('h1','找到會員，記下一次好購物。'));
 const row=el('div',undefined,'row'),input=el('input');input.placeholder='姓名、電話或完整會員編號';input.setAttribute('aria-label','搜尋會員');input.value=memberQuery;
 const list=el('div'),detail=el('div');detail.id='member-detail';let searchVersion=0;
 const search=async()=>{const version=++searchVersion;status('正在查詢會員…');const d=await api('search',{query:memberQuery,offset:memberOffset});if(epoch!==thisEpoch||version!==searchVersion)return;list.replaceChildren();
  if(!d.rows.length)list.append(el('p','查無會員。客戶需先從 LINE 登入建立會員卡。','empty'));
  else list.append(table(['客戶','電話','會員編號','操作'],d.rows.map(m=>[m.display_name,m.phone||'—',el('span',m.id,'code'),button('查看／新增消費',()=>openMember(m.id),'small secondary')])));
  const pager=el('div',undefined,'row');pager.append(el('span',`第 ${memberOffset+1} 筆起`,'muted'));if(memberOffset)pager.append(button('上一頁',async()=>{memberOffset-=50;await search();},'secondary'));if(d.has_more)pager.append(button('下一頁',async()=>{memberOffset+=50;await search();},'secondary'));list.append(pager);status('請選取會員。');
 };
 let debounce;const trigger=async()=>{clearTimeout(debounce);memberQuery=input.value;memberOffset=0;await search();};input.oninput=()=>{clearTimeout(debounce);searchVersion++;debounce=setTimeout(()=>{if(epoch===thisEpoch)trigger().catch(err=>status(err.message,true));},350);};input.onkeydown=e=>{if(e.key==='Enter')trigger().catch(err=>status(err.message,true));};row.append(input,button('查詢',trigger));view.append(row,list,detail);await search();
}
function itemsEditor(container,initial=[]){
 const rows=el('div',undefined,'item-editor');container.append(rows);let entries=[];
 function add(item={name:'',qty:1,price:0}){
  const row=el('div',undefined,'item-row'),id=++inputSequence;
  const name=field(row,'品名','item-name-'+id,'text',item.name,true);name.maxLength=100;
  const qty=field(row,'數量','item-qty-'+id,'number',item.qty,true);qty.min=1;qty.max=10000;qty.step=1;
  const price=field(row,'單價（元）','item-price-'+id,'number',item.price,true);price.min=0;price.max=10000000;price.step=1;
  const entry={row,name,qty,price};entries.push(entry);row.append(button('移除',()=>{entries=entries.filter(x=>x!==entry);row.remove();container.dispatchEvent(new Event('input',{bubbles:true}));},'small secondary'));rows.append(row);
 }
 (initial.length?initial:[{}]).forEach(i=>add({name:'',qty:1,price:0,...i}));
 container.append(button('＋ 新增購買項目',()=>{if(entries.length>=50)throw Error('最多 50 個購買項目');add();},'secondary'));
 return ()=>{if(!entries.length)throw Error('至少需要一個購買項目');return entries.map(e=>{const item={name:e.name.value.trim(),qty:Number(e.qty.value),price:Number(e.price.value)};if(!item.name||!e.qty.value||!e.price.value||!Number.isSafeInteger(item.qty)||!Number.isSafeInteger(item.price)||item.qty<1||item.qty>10000||item.price<0||item.price>10000000)throw Error('請完整填寫品名、整數數量與單價');return item;});};
}
function itemDialog(t,mid){
 const dialog=el('dialog'),form=el('form');form.append(el('h2','補充／更正購買項目'),el('p',`此筆原金額 ${money(t.gross)}；項目合計必須一致，才不會改動點數。`,'muted'));const getItems=itemsEditor(form,t.items||[]);
 submit(form,'儲存項目',async()=>{const items=getItems();if(items.reduce((s,i)=>s+i.qty*i.price,0)!==t.gross)throw Error('項目小計合計必須等於原金額');await api('items',{data:{member_id:mid,id:t.id,items}});dialog.close();await openMember(mid);status('購買項目已更新，操作已留存紀錄。');});form.append(button('取消',()=>dialog.close(),'secondary'));dialog.append(form);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
}
let detailVersion=0;
async function openMember(mid){
 const version=++detailVersion,hereEpoch=epoch;status('正在載入會員資料…');const d=await api('detail',{member_id:mid});if(version!==detailVersion||epoch!==hereEpoch)return;selected=mid;
 const box=$('#member-detail');if(!box)return;box.replaceChildren(summary(d));
 const grid=el('div',undefined,'forms-grid'),profile=el('form',undefined,'card');profile.append(el('h2','客戶資料'));
 field(profile,'姓名','display_name','text',d.member.display_name,true).maxLength=100;field(profile,'電話','phone','tel',d.member.phone).maxLength=30;field(profile,'店內備註（客戶看不到）','profile-note','textarea',d.member.note).maxLength=1000;
 submit(profile,'儲存客戶資料',async data=>{await api('profile',{data:{member_id:mid,display_name:data.display_name,phone:data.phone,note:data['profile-note']}});await openMember(mid);status('客戶資料已儲存；上方名單可按查詢更新。');});
 const sale=el('form',undefined,'card');sale.append(el('h2','新增消費'));
 const getItems=itemsEditor(sale),redeemed=field(sale,'折抵點數','redeemed','number','0',true);redeemed.min=0;redeemed.step=1;redeemed.max=d.points;
 field(sale,'消費時間（台灣時間）','occurred_at','datetime-local',taipeiNow(),true);
 field(sale,'訂單編號（選填）','external_id').maxLength=100;
 field(sale,'店內交易備註','sale-note','textarea').maxLength=1000;
 const preview=el('p','填妥項目後，這裡會顯示實付與回饋。','sale-preview');sale.append(preview);let pending=null,pendingKey='';
 sale.addEventListener('input',()=>{try{const gross=getItems().reduce((s,i)=>s+i.qty*i.price,0),paid=gross-Number(redeemed.value);preview.textContent=paid>=0?`原金額 ${money(gross)} · 實付 ${money(paid)} · 回饋 ${Math.floor(paid/100)*10} 點`:'折抵不可超過原金額';}catch{preview.textContent='請完整填妥購買項目。';}});
 submit(sale,'確認新增消費',async data=>{
  const items=getItems(),gross=items.reduce((s,i)=>s+i.qty*i.price,0),points=Number(data.redeemed);
  if(!Number.isSafeInteger(gross)||gross<=0||gross>10000000||!Number.isSafeInteger(points)||points<0||points>Math.min(gross,d.points))throw Error('請檢查金額與可用點數');
  const payload={member_id:mid,items,gross,redeemed:points,occurred_at:new Date(data.occurred_at+':00+08:00').toISOString(),external_id:data.external_id.trim()||null,note:data['sale-note']};
  const key=JSON.stringify(payload);if(key!==pendingKey){pending={...payload,id:crypto.randomUUID()};pendingKey=key;}
  const receipt=await api('sale',{data:pending});status(receipt.duplicate?'此交易已入帳，未重複加點。':'交易已儲存，正在更新畫面…');await openMember(mid);
 });grid.append(profile,sale);box.append(grid);
 const history=panel('交易紀錄 · 僅管理端可見'),historyBody=el('div');let transactions=[...d.transactions],cursor=d.next;
 function renderHistory(){historyBody.replaceChildren();if(!transactions.length){historyBody.append(el('p','目前沒有交易。','empty'));return;}
 historyBody.append(table(['消費時間／品項','原金額','折抵','實付','回饋','狀態／操作'],transactions.map(t=>{
  const info=el('details');info.append(el('summary',dateText(t.occurred_at)+' · '+(t.items?.length?t.items.map(i=>i.name+' × '+i.qty).join('、'):'尚無品項')));
  info.append(el('p',itemText(t.items)));if(t.items?.length)info.append(table(['品名','數量','單價','小計'],t.items.map(i=>[i.name,i.qty,money(i.price),money(i.qty*i.price)])));
  info.append(el('p','交易編號：'+t.id,'code'));if(t.external_id)info.append(el('p','訂單編號：'+t.external_id));if(t.note)info.append(el('p','店內備註：'+t.note));if(t.void_reason)info.append(el('p','作廢原因：'+t.void_reason));
  const actions=el('div',undefined,'row');actions.append(el('span',t.voided_at?'已作廢':'有效',t.voided_at?'badge void':'badge'));
  if(!t.voided_at)actions.append(button('編輯項目',()=>itemDialog(t,mid),'small secondary'),button('作廢',async()=>{const reason=prompt('請輸入作廢原因，系統會回沖點數並保留紀錄。');if(!reason?.trim())return;if(!confirm('確定作廢此交易？'))return;await api('void',{data:{member_id:mid,id:t.id,reason}});await openMember(mid);status('交易已作廢，點數已回沖。');},'small danger'));
  return [info,money(t.gross),t.redeemed,money(t.paid),t.earned,actions];
 })));}
 renderHistory();history.append(historyBody);const more=button('載入較早交易',async()=>{if(!cursor)return;const page=await api('detail',{member_id:mid,cursor});if(selected!==mid||version!==detailVersion)return;transactions.push(...page.transactions);cursor=page.next;renderHistory();if(!cursor)more.remove();status('已載入較早交易。');},'secondary');if(cursor)history.append(more);box.append(history);box.scrollIntoView({behavior:'smooth',block:'start'});status('會員資料已更新。');
}
async function imports(){
 const thisEpoch=++epoch;selected=null;view.replaceChildren(el('p','SPREADSHEETS · 試算表','eyebrow'),el('h1','把整理好的消費帶進來。'));
 const help=panel('先下載範本，再上傳 CSV');help.append(el('p','使用 Excel 或 Google Sheets 填寫，另存 CSV UTF-8。每行一個購買項目，相同訂單編號會合併成一筆交易。'),el('p','每次最多 200 筆訂單／2,000 行項目／1 MB。只接受已有 LINE 會員的完整會員編號；不會用姓名猜測配對。','muted'),button('下載空白匯入範本',()=>download('消費匯入範本.csv',csvText(importHeaders,[])),'secondary'));view.append(help);
 const form=panel('上傳與檢查'),file=el('input');file.type='file';file.accept='.csv,text/csv';file.setAttribute('aria-label','CSV 交易檔案');form.append(file);const preview=el('div');form.append(preview);view.append(form);
 let pending=null,checked=false,fileVersion=0;
 file.onchange=async()=>{const version=++fileVersion;pending=null;checked=false;preview.replaceChildren();try{const f=file.files[0];if(!f)return;if(f.size>1000000)throw Error('檔案請小於 1 MB');const text=await f.text();if(epoch!==thisEpoch||version!==fileVersion)return;pending=parseImport(text);
  const total=pending.reduce((s,t)=>s+t.gross-t.redeemed,0),earned=pending.reduce((s,t)=>s+Math.floor((t.gross-t.redeemed)/100)*10,0);
  preview.append(el('h2',`${pending.length} 筆訂單待檢查`),el('p',`檔案合計實付 ${money(total)}；預計回饋 ${earned} 點（含可能重複的訂單，尚未入帳）。`),table(['訂單','會員編號','項目','原金額','折抵'],pending.slice(0,10).map(t=>[t.external_id,el('span',t.member_id,'code'),itemText(t.items),money(t.gross),t.redeemed])),el('p','預覽前 10 筆。折抵、會員存在與重複訂單由伺服器完整檢查。','muted'));
  const checkText=el('p'),commit=button('確認正式匯入',async()=>{if(!checked||!pending)throw Error('請先檢查資料');if(!confirm(`確認匯入 ${pending.length} 筆訂單？回饋將正式計入會員餘額。`))return;
   file.disabled=true;try{const result=await api('import',{rows:pending,dry_run:false});pending=null;checked=false;file.value='';preview.replaceChildren(el('h2','匯入完成'),el('p',`新增 ${result.created} 筆，略過相同內容的重複訂單 ${result.duplicates} 筆。`));status('交易與點數已更新。');}finally{file.disabled=false;}
  });commit.disabled=true;
  preview.append(button('先檢查資料（不入帳）',async()=>{file.disabled=true;try{const result=await api('import',{rows:pending,dry_run:true});if(epoch!==thisEpoch)return;checked=true;commit.disabled=false;checkText.textContent=`檢查通過：將新增 ${result.created} 筆，略過 ${result.duplicates} 筆。正式匯入會再次檢查最新餘額。`;}finally{file.disabled=false;}},'secondary'),checkText,commit);
  status('檔案已讀取，尚未寫入任何交易。');
 }catch(e){status(e.message,true);}};
 view.append(el('p','匯入採整批成功或整批取消。有任何一筆失敗，不會留下部分新交易。歷史補登會按目前點數餘額檢查，不會重算過往每個時點的餘額。已作廢的相同訂單不會因重傳檔案而復活。','muted'));status('Excel／Google Sheets 請先另存 CSV UTF-8；不是即時雲端同步。');
}
async function logout(){await api('logout');login();status('已登出此瀏覽器。');}
async function start(){
 root.replaceChildren(el('p','正在確認登入狀態…','muted'));
 try{await api('session');shell();await overview();}
 catch(e){if(e.status===401||e.status===403){login();if(e.status===403)status(e.message,true);}else{root.replaceChildren(button('重試連線',start,'secondary'));status(e.message,true);}}
}
window.addEventListener('admin-session-ended',()=>{login();status('登入已失效，請重新登入。',true);});
start();loadConfig().then(c=>{document.title=c.store+'｜店家管理';const info=el('div',`版本 ${c.version} · 更新 ${dateText(c.builtAt)}${c.commit?' · '+c.commit:''}`,'version-info');info.append(button('檢查資料庫版本',async()=>{const h=await api('health');status(`網站 ${c.version} · 資料庫 ${h.schema_version} · 核對 ${dateText(h.checked_at)}`);},'small secondary'));document.querySelector('footer').append(info);}).catch(e=>status(e.message,true));
