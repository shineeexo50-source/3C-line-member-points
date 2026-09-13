// Optional DOM interaction suite. Set HAPPY_DOM_MODULE to a local happy-dom module.
import assert from 'node:assert/strict';
const {Window}=await import(process.env.HAPPY_DOM_MODULE||'happy-dom');const win=new Window({url:'https://example.test/admin.html'});
for(const name of ['window','document','navigator','location','Node','FormData','Event'])Object.defineProperty(globalThis,name,{value:name==='window'?win:win[name],configurable:true,writable:true});
document.body.innerHTML='<div id="status"></div><div id="app"></div>';
let saved=[],configured=false;
global.fetch=async(url,opts)=>{const b=JSON.parse(opts.body);let d={};let code=200;
 if(b.action==='custom_orders'){
  if(b.data.op==='create'||b.data.op==='update'){d={...b.data,version:b.data.version+1,notified:false};saved=[d];}
  else if(b.data.op==='delete'){saved=[];d={deleted:true};}
 }else if(b.action==='notify_order'){
  if(configured){saved[0].notified=true;d={accepted:true,order:saved[0]};}else {code=409;d={error:'LINE通知尚未啟用',code:'LINE-MSG-CFG'};}
 }else if(b.action==='line_status')d={configured};
 return new Response(JSON.stringify(d),{status:code});
};
const {orderEditor,orderCard,validatePayment}=await import('../public/custom-orders-v4.js');
const mid='11111111-1111-4111-8111-111111111111';
const form=orderEditor(mid,['小美','阿華'],null,()=>{});document.querySelector('#app').append(form);
const field=(scope,label)=>{const explicit=[...scope.querySelectorAll('[aria-label]')].find(x=>x.getAttribute('aria-label')===label);if(explicit)return explicit;const lab=[...scope.querySelectorAll('label')].find(l=>l.textContent===label);return scope.querySelector('[id="'+lab.htmlFor+'"]');};
const check=(scope,label,on)=>{const e=field(scope,label);e.checked=on;e.dispatchEvent(new Event('change'));};
const btn=(scope,name)=>[...scope.querySelectorAll('button')].find(x=>x.textContent===name);
field(form,'訂購品名').value='保護殼';field(form,'負責店員').value='小美';assert.equal(field(form,'已付清金額').disabled,true);check(form,'已付訂金',true);field(form,'已付訂金金額').value='200';
await form.onsubmit(new Event('submit',{cancelable:true}));assert.equal(saved.length,1);assert.equal(saved[0].deposit_amount,200);assert.equal(saved[0].full_amount,0);
const id=saved[0].id;form.remove();
const card=orderCard(saved[0],'王小姐',['小美','阿華']);document.querySelector('#app').append(card);
assert.deepEqual([...card.querySelectorAll('.v4-order-controls button')].map(x=>x.textContent),['編輯','一鍵LINE通知','刪除']);
await btn(card,'編輯').onclick();const edit=card.querySelector('form');assert.ok(edit);assert.equal(card.querySelector('dialog'),null);
check(edit,'已付清',true);field(edit,'已付清金額').value='1000';field(edit,'訂購品名').value='黑色保護殼';field(edit,'負責店員').value='阿華';field(edit,'備註（選填）').value='已收全額';
await edit.onsubmit(new Event('submit',{cancelable:true}));assert.equal(saved[0].id,id);assert.equal(saved[0].full_amount,1000);assert.equal(saved[0].deposit_amount,200);assert.equal(saved[0].staff_name,'阿華');assert.equal(saved[0].note,'已收全額');assert.equal(card.querySelector('form'),null);
assert.throws(()=>validatePayment({...saved[0],full_amount:10}));
await btn(card,'一鍵LINE通知').onclick();assert.match(card.textContent,/LINE通知尚未啟用/);assert.equal(saved[0].notified,false);assert.equal([...card.querySelectorAll('a')].find(x=>x.textContent==='開啟官方帳號聊天管理').href,'https://chat.line.biz/');
configured=true;await btn(card,'一鍵LINE通知').onclick();assert.equal(saved[0].notified,true);assert.match(card.textContent,/不代表客人已讀/);
await btn(card,'刪除').onclick();assert.ok(btn(card,'確定刪除'));await btn(card,'確定刪除').onclick();assert.equal(saved.length,0);assert.equal(card.isConnected,false);
await win.happyDOM.close();console.log('PASS DOM: checkbox/amount pairs, complete inline editing, retained id, 3 record actions, missing LINE guidance, accepted notification, deletion');
