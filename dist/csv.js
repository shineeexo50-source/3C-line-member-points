export const importHeaders=['訂單編號','會員編號','消費時間','購買項目','數量','單價','折抵點數','店內備註'];
export function parseCSV(text){
 text=String(text).replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false,endedQuote=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;endedQuote=true;}}else cell+=c;continue;}
  if(c==='"'){if(cell||endedQuote)throw Error('CSV 引號格式錯誤');quoted=true;continue;}
  if(c===','||c==='\n'||c==='\r'){
   row.push(cell);cell='';endedQuote=false;
   if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(x=>x.trim()!==''))rows.push(row);row=[];}continue;
  }
  if(endedQuote)throw Error('CSV 引號結尾後有多餘內容');cell+=c;
 }
 if(quoted)throw Error('CSV 有未關閉的引號');row.push(cell);if(row.some(x=>x.trim()!==''))rows.push(row);return rows;
}
export function csvText(headers,rows){
 const cell=value=>{let s=String(value??'');if(typeof value!=='number'&&/^(\s*[=+\-@]|[\t\r])/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 return '\uFEFF'+[headers,...rows].map(r=>r.map(cell).join(',')).join('\r\n');
}
function integer(s,label,min,max){if(!/^\d+$/.test(s))throw Error(label+'必須是整數');const n=Number(s);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error(label+'超出範圍');return n;}
export function parseImport(text){
 if(new TextEncoder().encode(text).length>1000000)throw Error('CSV 請小於 1 MB');
 const rows=parseCSV(text);if(!rows.length)throw Error('CSV 沒有內容');const headers=rows.shift().map(h=>h.trim());
 if(headers.length!==importHeaders.length||!headers.every((h,i)=>h===importHeaders[i]))throw Error('欄位不符合範本，請先下載匯入範本');
 if(rows.length>2000)throw Error('每次最多 2,000 行項目');if(!rows.length)throw Error('請先在範本填寫交易');
 const orders=new Map();
 rows.forEach((r,index)=>{
  const line=index+2;if(r.length!==8)throw Error(`第 ${line} 行欄位數量不正確`);
  let [external_id,member_id,when,name,q,price,redeem,note]=r.map(x=>x.trim());
  try{
   if(!external_id||external_id.length>100)throw Error('訂單編號需 1～100 字');
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(member_id))throw Error('請使用完整會員 UUID 編號');
   if(!/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d)?(?:Z|\+08:00)?$/.test(when))throw Error('時間請填 YYYY-MM-DD HH:mm 或含 +08:00 的 ISO 時間');
   const local=when.replace(' ','T');const normalized=/(Z|\+08:00)$/.test(local)?local:local+'+08:00';const date=new Date(normalized);
   if(!Number.isFinite(date.getTime()))throw Error('日期不正確');
   // Reject dates such as February 30 instead of silently rolling into March.
   const expected=normalized.slice(0,10),actual=new Date(date.getTime()+(normalized.endsWith('Z')?0:8*3600000)).toISOString().slice(0,10);if(expected!==actual)throw Error('日期不存在');
   if(date.getTime()>Date.now()+300000||date.getUTCFullYear()<2000)throw Error('時間不可在未來，且需在 2000 年之後');
   if(!name||name.length>100)throw Error('品名需 1～100 字');if(note.length>1000)throw Error('備註超過 1,000 字');
   const qty=integer(q,'數量',1,10000),unit=integer(price,'單價',0,10000000),points=redeem===''?null:integer(redeem,'折抵點數',0,10000000);
   const occurred_at=date.toISOString();let order=orders.get(external_id);
   if(!order){order={id:crypto.randomUUID(),external_id,member_id:member_id.toLowerCase(),occurred_at,items:[],gross:0,redeemed:points??0,note};orders.set(external_id,order);}
   else if(order.member_id!==member_id.toLowerCase()||order.occurred_at!==occurred_at||(points!==null&&order.redeemed!==points)||(note&&order.note!==note))throw Error('同一訂單的會員、時間、折抵或備註不一致');
   order.items.push({name,qty,price:unit});order.gross+=qty*unit;
   if(order.items.length>50||order.gross>10000000)throw Error('每筆最多 50 個項目，原金額最多 1,000 萬');
  }catch(e){throw Error(`第 ${line} 行：${e.message}`);}
 });
 if(orders.size>200)throw Error('每次最多 200 筆訂單，請拆檔');
 for(const order of orders.values())if(order.gross<=0||order.redeemed>order.gross)throw Error(`訂單 ${order.external_id}：原金額須大於 0，折抵不可超過原金額`);
 return [...orders.values()];
}
