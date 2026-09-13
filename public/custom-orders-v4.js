import {el,button,panel,field,api,status,money,dateText,taipeiNow} from './core.js';

export function validatePayment(data){
 for(const [flag,key,label] of [['paid_in_full','full_amount','付清總額'],['deposit_paid','deposit_amount','訂金']]){
  if(typeof data[flag]!=='boolean'||!Number.isSafeInteger(data[key])||data[key]<0||data[key]>10000000||(!data[flag]&&data[key]!==0)||(data[flag]&&data[key]===0))throw Error(`請勾選${label}狀態並填寫正確的整數金額`);
 }
 if(data.paid_in_full&&data.full_amount<data.deposit_amount)throw Error('付清總額包含訂金，不可小於訂金金額');
 return data;
}
function localTime(iso){if(!iso)return taipeiNow();return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso)).replace(' ','T');}
function errorText(e){return e?.message||'暫時無法完成，請稍後再試。';}
function paymentField(form,label,key,checked,amount){
 const row=el('div',undefined,'v4-payment-row'),wrap=el('label',undefined,'v4-payment-check'),check=el('input');check.type='checkbox';check.checked=!!checked;check.setAttribute('aria-label',label);wrap.append(check,el('span',label));
 const input=el('input');input.type='number';input.min='1';input.max='10000000';input.step='1';input.inputMode='numeric';input.name=key;input.placeholder='填寫金額';input.setAttribute('aria-label',label+'金額');input.value=amount==null?'':String(amount||'');
 const sync=()=>{input.disabled=!check.checked;input.required=check.checked;};check.addEventListener('change',sync);sync();row.append(wrap,input,el('span','元'));form.append(row);return {check,input};
}
export function orderEditor(mid,staff,o,onSaved,onCancel){
 const form=el('form',undefined,'v4-order-editor'),id=o?.id||crypto.randomUUID(),prefix='order-'+id+'-',heading=el('h3',o?'編輯客訂商品':'新增客訂商品');form.append(heading);
 const grid=el('div',undefined,'custom-order-grid');
 const time=field(grid,'訂購日期／時間',prefix+'time','datetime-local',o?localTime(o.ordered_at):taipeiNow(),true),product=field(grid,'訂購品名',prefix+'product','text',o?.product_name||'',true);product.maxLength=200;form.append(grid);
 const pay=el('fieldset',undefined,'v4-payment-fields');pay.append(el('legend','付款紀錄'));
 const full=paymentField(pay,'已付清','full_amount',o?.paid_in_full,o?.full_amount),deposit=paymentField(pay,'已付訂金','deposit_amount',o?.deposit_paid,o?.deposit_amount);form.append(pay,el('p','付清金額請填總收款（含訂金）；兩項皆可保留勾選，不會重複加總。','muted'));
 if(o?.paid_in_full&&o.full_amount==null)form.append(el('p','這筆舊紀錄未保存付清金額，請核對後補填。','muted'));
 const staffWrap=el('div',undefined,'field'),staffLabel=el('label','負責店員'),staffSelect=el('select');staffSelect.id=prefix+'staff';staffLabel.htmlFor=staffSelect.id;
 for(const name of ['',...new Set([...(staff||[]),...(o?.staff_name?[o.staff_name]:[])])]){const option=el('option',name||'未指定');option.value=name;staffSelect.append(option);}
 const add=el('option','＋ 輸入其他店員');add.value='__new_staff__';staffSelect.append(add);staffSelect.value=o?.staff_name||'';staffWrap.append(staffLabel,staffSelect);form.append(staffWrap);
 const newStaff=field(form,'其他店員姓名',prefix+'new-staff');newStaff.maxLength=60;newStaff.parentElement.hidden=true;staffSelect.onchange=()=>{newStaff.parentElement.hidden=staffSelect.value!=='__new_staff__';newStaff.required=staffSelect.value==='__new_staff__';};
 const note=field(form,'備註（選填）',prefix+'note','textarea',o?.note||'');note.maxLength=1000;
 const message=el('p',undefined,'v4-form-error');message.setAttribute('role','alert');form.append(message);
 const actions=el('div',undefined,'row'),save=el('button',o?'儲存全部修改':'新增客訂');save.type='submit';actions.append(save);
 if(onCancel)actions.append(button('取消編輯',()=>{if(!save.disabled)onCancel();},'secondary'));form.append(actions);
 form.onsubmit=async e=>{e.preventDefault();if(save.disabled)return;save.disabled=true;message.textContent='';try{
  const ordered_at=o&&time.value===localTime(o.ordered_at)?o.ordered_at:new Date(time.value+':00+08:00').toISOString();
  const data=validatePayment({op:o?'update':'create',member_id:mid,id,version:o?.version??0,ordered_at,product_name:product.value.trim(),paid_in_full:full.check.checked,full_amount:full.check.checked?Number(full.input.value):0,deposit_paid:deposit.check.checked,deposit_amount:deposit.check.checked?Number(deposit.input.value):0,staff_name:(staffSelect.value==='__new_staff__'?newStaff.value:staffSelect.value).trim(),note:note.value.trim()});
  const result=await api('custom_orders',{data});message.textContent='';await onSaved(result);status(o?'客訂資料已更新。':'客訂商品已新增。');
 }catch(err){message.textContent=errorText(err);status(errorText(err),true);}finally{save.disabled=false;}};
 return form;
}
export function lineSettingsPanel(){
 const box=panel('LINE通知'),state=el('p','檢查通知設定中…','muted');box.append(state);
 const details=el('details');details.append(el('summary','查看啟用方式'),el('p','請由系統管理者將官方帳號 Messaging API 的 Channel access token 設定到 Vercel 的 LINE_CHANNEL_ACCESS_TOKEN，然後重新部署。不要把憑證貼進網頁、GitHub或聊天室。'),el('p','LINE Login 與 Messaging API 須使用同一個 Provider。會員須有有效的 LINE 綁定，並符合官方帳號收訊條件。'));
 const docs=el('a','開啟 LINE 官方設定說明');docs.href='https://developers.line.biz/en/docs/messaging-api/getting-started/';docs.target='_blank';docs.rel='noopener noreferrer';details.append(docs);box.append(details);
 const inbox=el('a','開啟官方帳號聊天管理');inbox.href='https://chat.line.biz/';inbox.target='_blank';inbox.rel='noopener noreferrer';box.append(inbox,el('p','聊天管理連結會開啟官方帳號後台；它不會自動選取某位客人。一鍵通知會由伺服器發訊，不需拼接聊天室連結。','muted'));
 const check=async()=>{try{const d=await api('line_status');state.textContent=d.configured?'已填寫發訊憑證；實際有效性於發送時驗證。':'LINE通知尚未啟用，請展開下方啟用方式。';if(!d.configured)details.open=true;}catch(e){state.textContent=errorText(e);}};
 box.append(button('重新檢查',check,'secondary'));check();return box;
}
export function orderCard(o,memberName,staff,onChanged){
 const card=el('article',undefined,'custom-order-row v4-order-card');
 const render=()=>{
  card.replaceChildren();const summary=el('div',undefined,'custom-order-summary');summary.append(el('strong',o.product_name),el('span',`${dateText(o.ordered_at)} · 負責店員：${o.staff_name||'未指定'}`,'muted'));
  summary.append(el('p',`已付清：${o.paid_in_full?(o.full_amount==null?'金額未填':money(o.full_amount)):'未勾選'}　｜　已付訂金：${o.deposit_paid?money(o.deposit_amount):'未勾選'}`));
  if(o.note)summary.append(el('p',o.note,'order-note-preview'));summary.append(el('span',o.notified?'LINE已受理通知':'尚未通知',o.notified?'badge':'badge order-pending'));card.append(summary);
  const message=el('div',undefined,'v4-record-message');message.setAttribute('role','status');
  const controls=el('div',undefined,'custom-order-controls v4-order-controls');
  const edit=button('編輯',()=>{card.replaceChildren(orderEditor(o.member_id,staff,o,async saved=>{o=saved;render();await onChanged?.();},render));card.querySelector('input')?.focus();},'small secondary');
  const notify=button('一鍵LINE通知',async()=>{
   message.replaceChildren(el('p',`正在通知 ${memberName}…`));try{const result=await api('notify_order',{data:{member_id:o.member_id,id:o.id,version:o.version}});if(result.order)o=result.order;else o={...o,notified:true};render();card.querySelector('.v4-record-message').replaceChildren(el('p',result.duplicate?'此版本通知先前已受理，沒有重複發送。':'LINE已受理通知；不代表客人已讀或一定送達。'));await onChanged?.();status('LINE通知紀錄已更新。');}
   catch(e){message.replaceChildren(el('p',errorText(e),'v4-form-error'));if(['LINE-MSG-CFG','LINE-MSG-AUTH'].includes(e.code))message.append(lineSettingsPanel());status(errorText(e),true);}
  },'small order-notify');
  const del=button('刪除',()=>{
   const ask=el('div',undefined,'v4-delete-confirm');ask.append(el('p',`確定刪除「${o.product_name}」？紀錄將從列表移除，操作仍會保留。`),button('確定刪除',async()=>{await api('custom_orders',{data:{op:'delete',member_id:o.member_id,id:o.id,version:o.version}});card.remove();await onChanged?.();status('客訂已刪除。');},'small danger'),button('取消',()=>ask.remove(),'small secondary'));message.replaceChildren(ask);
  },'small danger');controls.append(edit,notify,del);card.append(controls,message);
 };render();return card;
}
export function customOrdersPanel(mid,memberName){
 const box=panel('客訂商品');box.append(el('p','勾選付款狀態並填寫金額。客訂紀錄不會自動增加點數或新增消費。','muted'));
 const add=el('div'),list=el('div'),pager=el('div',undefined,'row');let sequence=0,offset=0,staff=[],formReady=false;
 box.append(add,list,pager);
 const load=async()=>{const seq=++sequence;try{const d=await api('custom_orders',{data:{op:'list',member_id:mid,offset,limit:50}});if(seq!==sequence)return;staff=d.staff||[];
  if(!formReady){add.replaceChildren(orderEditor(mid,staff,null,async()=>{formReady=false;offset=0;await load();}));formReady=true;}
  list.replaceChildren(...(d.orders||[]).map(o=>orderCard(o,memberName,staff)));
  if(!d.orders?.length)list.append(el('p','目前沒有客訂商品。','empty'));
  pager.replaceChildren();if(offset)pager.append(button('上一頁',async()=>{offset-=50;await load();},'secondary'));if(d.has_more)pager.append(button('下一頁',async()=>{offset+=50;await load();},'secondary'));
 }catch(e){if(seq===sequence)list.replaceChildren(el('p',errorText(e),'v4-form-error'),button('重新載入客訂',load,'secondary'));}};
 list.append(el('p','正在載入客訂資料…','muted'));load();return box;
}
