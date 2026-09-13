-- V4.0.0: run after existing 01,04,06,09 migrations (08 is optional). Safe to repeat.
-- Preserves all existing orders and points. Old fully-paid amounts remain NULL (unknown).
begin;
alter table public.custom_orders add column if not exists full_amount integer check(full_amount between 0 and 10000000);
alter table public.custom_orders add column if not exists version integer not null default 1 check(version>0);
alter table public.custom_orders add column if not exists deleted_at timestamptz;
alter table public.custom_orders add column if not exists deleted_by uuid references auth.users(id);
create index if not exists custom_orders_active_v400 on public.custom_orders(member_id,paid_in_full,ordered_at desc,id desc) where deleted_at is null;
create table if not exists public.order_notifications(
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.custom_orders(id),
 order_version integer not null, member_id uuid not null references public.members(id),
 line_id text not null, message text not null, status text not null default 'pending' check(status in ('pending','accepted')),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(), accepted_at timestamptz,
 unique(order_id,order_version)
);
alter table public.order_notifications enable row level security;
revoke all on public.order_notifications from public,anon,authenticated;

create or replace function public.admin_custom_orders_v400(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare mid uuid; o custom_orders; prev custom_orders; incoming custom_orders; nm text; n integer; skip integer; q text; result jsonb;
begin
 perform require_admin_v2(p_actor);
 mid=nullif(p_data->>'member_id','')::uuid;
 if p_action in ('list','global') then
  n=least(300,greatest(1,coalesce((p_data->>'limit')::integer,50))); skip=greatest(0,least(coalesce((p_data->>'offset')::integer,0),100000));q=trim(coalesce(p_data->>'query',''));
  if p_action='list' and not exists(select 1 from members where id=mid) then raise exception '找不到會員'; end if;
  with matched as (
   select c.*,m.display_name,m.phone from custom_orders c join members m on m.id=c.member_id
   where c.deleted_at is null and (p_action='global' or c.member_id=mid)
   and (q='' or position(lower(q) in lower(concat_ws(' ',m.display_name,m.phone,c.product_name,c.staff_name,c.note)))>0)
  ), page as (select * from matched order by paid_in_full,ordered_at desc,id desc limit n offset skip)
  select jsonb_build_object('orders',coalesce((select jsonb_agg(to_jsonb(page) order by paid_in_full,ordered_at desc,id desc) from page),'[]'::jsonb),
   'has_more',(select count(*)>skip+n from matched),'total',(select count(*) from matched),
   'staff',coalesce((select jsonb_agg(name order by name) from staff_options where active),'[]'::jsonb)) into result;
  return result;
 elsif p_action='staff_list' then
  return jsonb_build_object('staff',coalesce((select jsonb_agg(to_jsonb(s) order by name) from staff_options s),'[]'::jsonb));
 elsif p_action in ('staff_add','staff_set') then
  nm=trim(coalesce(p_data->>'name',''));if length(nm) not between 1 and 60 then raise exception '店員名字需為1至60字'; end if;
  if p_action='staff_add' then insert into staff_options(name,created_by) values(nm,p_actor) on conflict(name) do update set active=true;
  else
   if jsonb_typeof(p_data->'active') is distinct from 'boolean' then raise exception '請選擇店員狀態'; end if;
   update staff_options set active=(p_data->>'active')::boolean where name=nm;
  end if;
  return jsonb_build_object('name',nm);
 end if;
 perform 1 from members where id=mid for update;if not found then raise exception '找不到會員'; end if;
 select * into prev from custom_orders where id=(p_data->>'id')::uuid for update;
 if prev.id is not null and prev.member_id<>mid then raise exception '客訂不屬於此會員'; end if;
 if p_action='delete' then
  if prev.id is null then raise exception '找不到客訂資料'; end if;
  if prev.deleted_at is not null then return jsonb_build_object('deleted',true,'id',prev.id); end if;
  if prev.version is distinct from (p_data->>'version')::integer then raise exception '此客訂已被修改，請重新載入後再刪除'; end if;
  if exists(select 1 from order_notifications where order_id=prev.id and status='pending') then raise exception '此客訂的LINE通知結果待確認，請先重試通知或核對後再刪除'; end if;
  update custom_orders set deleted_at=now(),deleted_by=p_actor,updated_at=now(),version=version+1 where id=prev.id returning * into o;
  insert into audit(actor,action,member_id,old_data,new_data) values(p_actor,'custom_order_delete',mid,to_jsonb(prev),to_jsonb(o));
  return jsonb_build_object('deleted',true,'id',o.id);
 elsif p_action not in ('create','update') then raise exception '不支援的客訂操作'; end if;
 incoming=jsonb_populate_record(null::custom_orders,p_data);
 incoming.product_name=trim(incoming.product_name);incoming.staff_name=trim(coalesce(incoming.staff_name,''));incoming.note=coalesce(incoming.note,'');
 if incoming.product_name is null or length(incoming.product_name) not between 1 and 200 or length(incoming.staff_name)>60 or length(incoming.note)>1000 then raise exception '請檢查品名、店員與備註長度'; end if;
 if incoming.ordered_at is null or incoming.ordered_at<'2000-01-01'::timestamptz or incoming.ordered_at>now()+interval '5 minutes' then raise exception '請填寫正確的訂購日期與時間'; end if;
 if jsonb_typeof(p_data->'deposit_paid') is distinct from 'boolean' or jsonb_typeof(p_data->'paid_in_full') is distinct from 'boolean' then raise exception '請勾選正確付款狀態'; end if;
 if incoming.deposit_amount is null or incoming.deposit_amount<0 or incoming.deposit_amount>10000000 or (incoming.deposit_paid and incoming.deposit_amount=0) or (not incoming.deposit_paid and incoming.deposit_amount<>0) then raise exception '勾選已付訂金後請填寫金額；未勾選請填0'; end if;
 if incoming.full_amount is null or incoming.full_amount<0 or incoming.full_amount>10000000 or (incoming.paid_in_full and incoming.full_amount=0) or (not incoming.paid_in_full and incoming.full_amount<>0) then raise exception '勾選已付清後請填寫總收款金額；未勾選請填0'; end if;
 if incoming.paid_in_full and incoming.full_amount<incoming.deposit_amount then raise exception '付清總額包含訂金，不能小於已收訂金'; end if;
 if prev.id is not null then
  if prev.deleted_at is not null then raise exception '此客訂已刪除，請重新載入'; end if;
  if row(prev.product_name,prev.ordered_at,prev.deposit_amount,prev.deposit_paid,prev.paid_in_full,prev.full_amount,prev.staff_name,prev.note) is not distinct from row(incoming.product_name,incoming.ordered_at,incoming.deposit_amount,incoming.deposit_paid,incoming.paid_in_full,incoming.full_amount,incoming.staff_name,incoming.note) then return to_jsonb(prev); end if;
  if p_action='create' or prev.version is distinct from incoming.version then raise exception '此客訂已被其他店員修改，請重新載入後再編輯'; end if;
  if exists(select 1 from order_notifications where order_id=prev.id and status='pending') then raise exception 'LINE通知結果待確認，請先重試通知或核對後再修改'; end if;
  update custom_orders set product_name=incoming.product_name,ordered_at=incoming.ordered_at,deposit_amount=incoming.deposit_amount,deposit_paid=incoming.deposit_paid,
   full_amount=incoming.full_amount,paid_in_full=incoming.paid_in_full,staff_name=incoming.staff_name,note=incoming.note,version=version+1,updated_at=now(),notified=false,notified_at=null,notified_by=null
   where id=prev.id returning * into o;
 else
  if p_action<>'create' or incoming.version is distinct from 0 then raise exception '找不到客訂資料'; end if;
  insert into custom_orders(id,member_id,ordered_at,product_name,deposit_amount,deposit_paid,full_amount,paid_in_full,staff_name,note,created_by)
   values(incoming.id,mid,incoming.ordered_at,incoming.product_name,incoming.deposit_amount,incoming.deposit_paid,incoming.full_amount,incoming.paid_in_full,incoming.staff_name,incoming.note,p_actor) returning * into o;
 end if;
 if o.staff_name<>'' then insert into staff_options(name,created_by) values(o.staff_name,p_actor) on conflict(name) do nothing; end if;
 insert into audit(actor,action,member_id,old_data,new_data) values(p_actor,case when prev.id is null then 'custom_order_create' else 'custom_order_update' end,mid,case when prev.id is null then null else to_jsonb(prev) end,to_jsonb(o));
 return to_jsonb(o);
end $$;

create or replace function public.admin_order_notify_v400(p_actor uuid,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare o custom_orders; m members; job order_notifications; txt text;
begin
 perform require_admin_v2(p_actor);
 select * into o from custom_orders where id=(p_data->>'id')::uuid and member_id=(p_data->>'member_id')::uuid for update;
 if not found or o.deleted_at is not null then raise exception '找不到有效的客訂資料'; end if;
 if p_action='prepare' then
  if o.version is distinct from (p_data->>'version')::integer then raise exception '客訂內容已更新，請重新載入後再通知'; end if;
  select * into job from order_notifications where order_id=o.id and order_version=o.version;
  if job.id is not null then
   if job.status='pending' and job.created_at<now()-interval '23 hours' then raise exception '上次通知結果尚未確認且已超過重試期限，請先至官方帳號核對，勿重複發送'; end if;
   return to_jsonb(job);
  end if;
  if exists(select 1 from order_notifications where order_id=o.id and created_at>now()-interval '30 seconds') then raise exception '通知操作太頻繁，請稍後再試'; end if;
  select * into m from members where id=o.member_id;
  if m.line_id !~ '^U[0-9a-fA-F]{32}$' then raise exception '此會員尚未綁定可通知的LINE帳號，請先讓客人使用LINE會員頁登入'; end if;
  txt=m.display_name||'您好，您在'||left(coalesce(nullif(p_data->>'store',''),'門市'),100)||'訂購的「'||o.product_name||'」已有最新進度，請與我們聯繫確認。'||case when o.staff_name<>'' then E'\n負責店員：'||o.staff_name else '' end;
  insert into order_notifications(order_id,order_version,member_id,line_id,message,created_by) values(o.id,o.version,o.member_id,m.line_id,txt,p_actor) returning * into job;
  return to_jsonb(job);
 elsif p_action='accept' then
  select * into job from order_notifications where id=(p_data->>'request_id')::uuid and order_id=o.id for update;
  if not found then raise exception '找不到LINE通知紀錄'; end if;
  if job.status='accepted' then return to_jsonb(o); end if;
  update order_notifications set status='accepted',accepted_at=now() where id=job.id;
  update custom_orders set notified=true,notified_at=now(),notified_by=p_actor,updated_at=now() where id=o.id returning * into o;
  insert into audit(actor,action,member_id,new_data) values(p_actor,'custom_order_notify',o.member_id,to_jsonb(o));
  return to_jsonb(o);
 elsif p_action='reject' then
  -- Only called by server when LINE definitively rejected the request (4xx).
  delete from order_notifications where id=(p_data->>'request_id')::uuid and order_id=o.id and status='pending';
  return '{}'::jsonb;
 end if;
 raise exception '不支援的通知操作';
end $$;

create or replace function public.admin_backup_v400(p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 perform require_admin_v2(p_actor);
 lock table admins,members,transactions,audit,staff_options,custom_orders,order_notifications in share mode;
 result=jsonb_build_object('format','line-member-business','version',6,'created_at',now(),
  'admins',coalesce((select jsonb_agg(to_jsonb(x) order by user_id) from admins x),'[]'::jsonb),
  'members',coalesce((select jsonb_agg(to_jsonb(x) order by id) from members x),'[]'::jsonb),
  'transactions',coalesce((select jsonb_agg(to_jsonb(x) order by id) from transactions x),'[]'::jsonb),
  'audit',coalesce((select jsonb_agg(to_jsonb(x) order by id) from audit x),'[]'::jsonb),
  'staff_options',coalesce((select jsonb_agg(to_jsonb(x) order by name) from staff_options x),'[]'::jsonb),
  'custom_orders',coalesce((select jsonb_agg(to_jsonb(x) order by id) from custom_orders x),'[]'::jsonb),
  'order_notifications',coalesce((select jsonb_agg(to_jsonb(x) order by id) from order_notifications x),'[]'::jsonb),
  'points',(select coalesce(sum(earned-redeemed),0) from transactions where voided_at is null));
 if octet_length(result::text)>3000000 then raise exception '資料超過網頁備份容量，請使用資料庫備份'; end if;
 return result;
end $$;
revoke all on function public.admin_custom_orders_v400(uuid,text,jsonb),public.admin_order_notify_v400(uuid,text,jsonb),public.admin_backup_v400(uuid) from public,anon,authenticated;
grant execute on function public.admin_custom_orders_v400(uuid,text,jsonb),public.admin_order_notify_v400(uuid,text,jsonb),public.admin_backup_v400(uuid) to service_role;
-- Previous write RPC bypassed version checks and allowed manually setting notification status.
do $$ begin if to_regprocedure('public.admin_custom_orders_v38(uuid,text,jsonb)') is not null then execute 'revoke execute on function public.admin_custom_orders_v38(uuid,text,jsonb) from service_role';end if;end $$;
create or replace function public.admin_detail_v400(p_actor uuid,p_member uuid,p_offset integer default 0,p_summary boolean default true) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb; m members; rows jsonb; skip integer;
begin
 perform require_admin_v2(p_actor);select * into m from members where id=p_member;if not found then raise exception '找不到會員'; end if;
 skip=greatest(0,least(p_offset,100000));
 select coalesce(jsonb_agg(to_jsonb(t) order by occurred_at desc,id desc),'[]'::jsonb) into rows from (select id,gross,redeemed,paid,earned,occurred_at,voided_at,items,note,void_reason,external_id from transactions where member_id=p_member order by occurred_at desc,id desc limit 21 offset skip) t;
 result=jsonb_build_object('transactions',case when jsonb_array_length(rows)>20 then rows-20 else rows end,'next',case when jsonb_array_length(rows)>20 then jsonb_build_object('offset',skip+20) else null end);
 if p_summary then result=result||jsonb_build_object('member',jsonb_build_object('id',m.id,'display_name',m.display_name,'phone',m.phone,'note',m.note,'created_at',m.created_at))||(select jsonb_build_object('total',coalesce(sum(paid),0),'points',coalesce(sum(earned-redeemed),0),'visits',count(*)) from transactions where member_id=p_member and voided_at is null);end if;
 return result;
end $$;
revoke all on function public.admin_detail_v400(uuid,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.admin_detail_v400(uuid,uuid,integer,boolean) to service_role;
notify pgrst,'reload schema';
commit;
