// Business-data backup. Never includes Auth passwords, tokens or server keys.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function checksum(payload){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function wrapBackup(payload){validatePayload(payload);return {checksum:await checksum(payload),payload};}
export function validatePayload(p){
 if(!p||p.format!=='line-member-business'||![3,4,5].includes(p.version)||!Number.isFinite(Date.parse(p.created_at)))throw Error('不支援的備份格式');
 for(const key of ['admins','members','transactions','audit']){if(!Array.isArray(p[key]))throw Error('備份缺少 '+key);const ids=new Set();for(const row of p[key]){const id=key==='admins'?row.user_id:row.id;if(key==='audit'?!Number.isSafeInteger(id)||id<1:!uuid.test(id))throw Error('備份識別碼不正確');if(ids.has(id))throw Error('備份有重複識別碼');ids.add(id);}}
 if(p.version>=4){for(const key of ['staff_options','custom_orders'])if(!Array.isArray(p[key]))throw Error('備份缺少 '+key);const seen=new Set();for(const o of p.custom_orders){if(!uuid.test(o.id)||seen.has(o.id))throw Error('客訂識別碼不正確或重複');seen.add(o.id);}}
 if(p.version>=5){if(!Array.isArray(p.products))throw Error('備份缺少 products');const seenProducts=new Set();for(const x of p.products){if(!uuid.test(x.id)||seenProducts.has(x.id)||typeof x.name!=='string'||!x.name.trim()||!Number.isSafeInteger(x.stock_qty)||x.stock_qty<0)throw Error('商品資料驗證失敗');seenProducts.add(x.id);}}
 const members=new Set(p.members.map(m=>m.id));let points=0;
 for(const t of p.transactions){if(!members.has(t.member_id)||!Number.isSafeInteger(t.gross)||t.gross<1||t.gross>10000000||!Number.isSafeInteger(t.redeemed)||t.redeemed<0||t.redeemed>t.gross||t.paid!==t.gross-t.redeemed||t.earned!==Math.floor(t.paid/100)*10)throw Error('交易金額或會員關聯驗證失敗');if(!t.voided_at)points+=t.earned-t.redeemed;}
 if(!Number.isSafeInteger(points)||points!==p.points)throw Error('備份點數合計不一致');
 if(p.version>=4)for(const o of p.custom_orders){if(!members.has(o.member_id)||typeof o.product_name!=='string'||!o.product_name.trim()||!Number.isSafeInteger(o.deposit_amount)||o.deposit_amount<0)throw Error('客訂資料或會員關聯驗證失敗');}
 return {members:p.members.length,transactions:p.transactions.length,audit:p.audit.length,custom_orders:(p.custom_orders||[]).length,products:(p.products||[]).length,points};
}
export async function readBackup(text){if(new TextEncoder().encode(text).length>4000000)throw Error('備份檔過大，請使用資料庫還原流程');let doc;try{doc=JSON.parse(text);}catch{throw Error('檔案不是有效 JSON');}validatePayload(doc.payload);if(doc.checksum!==await checksum(doc.payload))throw Error('備份校驗碼不符，檔案可能損毀或已修改');return doc.payload;}
export function restoreSQL(payload,dry=true){
 validatePayload(payload);
 const literal="'"+JSON.stringify(payload).replaceAll("'","''")+"'";
 const v4=payload.version>=4,v5=payload.version>=5;
 const cols={members:'id,line_id,display_name,phone,note,created_at',transactions:'id,member_id,gross,redeemed,occurred_at,note,created_by,created_at,voided_at,voided_by,void_reason,items,external_id',audit:'id,actor,action,member_id,old_data,new_data,created_at'};
 if(v4){cols.staff_options='name,active,created_at,created_by';cols.custom_orders=v5?'id,member_id,ordered_at,product_name,deposit_amount,deposit_paid,paid_in_full,staff_name,notified,notified_at,notified_by,note,created_by,created_at,updated_at':'id,member_id,ordered_at,product_name,deposit_amount,deposit_paid,paid_in_full,staff_name,notified,notified_at,notified_by,created_by,created_at,updated_at';}if(v5)cols.products='id,name,sku,price,stock_qty,low_stock_qty,active,created_at,updated_at,created_by';
 let sql=`-- ${dry?'RESTORE DRILL: ends with ROLLBACK, no business data kept.':'RESTORE: commits business data to EMPTY tables only.'}
-- Run 01, 04, 06${v4?', 08':''}${v5?', 09':''} on a NEW recovery project first. Required original Auth user UUIDs must exist.
-- Does not restore Auth accounts/passwords, LINE settings, environment variables or storage files.
begin;
set local standard_conforming_strings=on;
lock table public.admins,public.members,public.transactions,public.audit${v4?',public.staff_options,public.custom_orders':''}${v5?',public.products':''} in exclusive mode;
create temporary table restore_payload_v3(data jsonb) on commit drop;
insert into restore_payload_v3 values (${literal}::jsonb);
do $$ begin
 if exists(select 1 from public.members) or exists(select 1 from public.transactions) or exists(select 1 from public.audit)${v4?" or exists(select 1 from public.custom_orders) or exists(select 1 from public.staff_options)":''}${v5?" or exists(select 1 from public.products)":''} then raise exception '還原已停止：目標業務資料表不是空的，不會覆蓋現有資料'; end if;
 if exists(with refs as (
 select value->>'user_id' id from restore_payload_v3,jsonb_array_elements(data->'admins')
 union select value->>'created_by' from restore_payload_v3,jsonb_array_elements(data->'transactions')
 union select value->>'voided_by' from restore_payload_v3,jsonb_array_elements(data->'transactions')
 union select value->>'actor' from restore_payload_v3,jsonb_array_elements(data->'audit')${v4?"\n union select value->>'created_by' from restore_payload_v3,jsonb_array_elements(data->'custom_orders')\n union select value->>'notified_by' from restore_payload_v3,jsonb_array_elements(data->'custom_orders')\n union select value->>'created_by' from restore_payload_v3,jsonb_array_elements(data->'staff_options')":''}${v5?"\n union select value->>'created_by' from restore_payload_v3,jsonb_array_elements(data->'products')":''})
 select 1 from refs where id is not null and not exists(select 1 from auth.users u where u.id=refs.id::uuid)) then raise exception '缺少原管理員 Auth UUID：請先還原 Auth 帳號；不要手動修改備份'; end if;
end $$;
insert into public.admins(user_id) select r.user_id from restore_payload_v3 p cross join lateral jsonb_populate_recordset(null::public.admins,p.data->'admins') r on conflict(user_id) do nothing;
`;
 for(const [table,columns] of Object.entries(cols))sql+=`insert into public.${table}(${columns}) ${table==='audit'?'overriding system value ':''}select ${columns.split(',').map(c=>'r.'+c).join(',')} from restore_payload_v3 p cross join lateral jsonb_populate_recordset(null::public.${table},p.data->'${table}') r;\n`;
 sql+=`do $$ declare p jsonb; begin
 select data into p from restore_payload_v3;
 if (select count(*) from public.members)<>jsonb_array_length(p->'members') or (select count(*) from public.transactions)<>jsonb_array_length(p->'transactions') or (select count(*) from public.audit)<>jsonb_array_length(p->'audit')${v4?" or (select count(*) from public.custom_orders)<>jsonb_array_length(p->'custom_orders') or (select count(*) from public.staff_options)<>jsonb_array_length(p->'staff_options')":''}${v5?" or (select count(*) from public.products)<>jsonb_array_length(p->'products')":''} or (select coalesce(sum(earned-redeemed),0) from public.transactions where voided_at is null)<>(p->>'points')::bigint then raise exception '還原核對失敗，整批取消'; end if;
end $$;
select '還原核對通過' as result,(select count(*) from public.members) members,(select count(*) from public.transactions) transactions,(select count(*) from public.audit) audit${v4?',(select count(*) from public.custom_orders) custom_orders':''}${v5?',(select count(*) from public.products) products':''},(select coalesce(sum(earned-redeemed),0) from public.transactions where voided_at is null) points;
`;
 if(!dry)sql+="select setval(pg_get_serial_sequence('public.audit','id'),greatest(1,coalesce((select max(id) from public.audit),0)),exists(select 1 from public.audit));\n";
 return sql+(dry?'rollback;':'commit;')+'\n';
}
