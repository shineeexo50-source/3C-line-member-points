-- Upgrade the supplied v1 schema in place. No member or transaction is deleted.
-- Back up first. Apply this BEFORE deploying the v2 website.
begin;
alter table public.transactions add column if not exists items jsonb not null default '[]'::jsonb;
alter table public.transactions add column if not exists external_id text;
create unique index if not exists transactions_external_id_unique on public.transactions(external_id) where external_id is not null;
create index if not exists transactions_member_page on public.transactions(member_id,occurred_at desc,id desc);
create index if not exists transactions_month_active on public.transactions(occurred_at,member_id) include(paid,earned,redeemed) where voided_at is null;
create index if not exists transactions_month_page on public.transactions(occurred_at desc,id desc);

create or replace function public.require_admin_v2(p_actor uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if p_actor is null or not exists(select 1 from admins where user_id=p_actor) then raise exception '沒有管理權限' using errcode='42501'; end if;
end $$;

create or replace function public.member_page_v2(p_member uuid,p_cursor jsonb default null,p_size integer default 20,p_summary boolean default true) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; rows_data jsonb; m jsonb; totals jsonb; last_row jsonb; more boolean; sz integer=least(100,greatest(1,p_size));
begin
 select to_jsonb(x)-'line_id'-'note' into m from members x where id=p_member;
 if m is null then raise exception '找不到會員'; end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc,x.id desc),'[]'::jsonb) into rows_data from
 (select id,gross,redeemed,paid,earned,occurred_at,voided_at,items from transactions where member_id=p_member
 and (p_cursor is null or (occurred_at,id)<((p_cursor->>'at')::timestamptz,(p_cursor->>'id')::uuid))
 order by occurred_at desc,id desc limit sz+1) x;
 more=jsonb_array_length(rows_data)>sz;
 if more then rows_data=rows_data-sz; end if;
 last_row=rows_data->(jsonb_array_length(rows_data)-1);
 result=jsonb_build_object('transactions',rows_data,'next',case when more then jsonb_build_object('at',last_row->>'occurred_at','id',last_row->>'id') else null end);
 if p_summary then
  select jsonb_build_object('total',coalesce(sum(paid),0),'points',coalesce(sum(earned-redeemed),0),'visits',count(*)) into totals from transactions where member_id=p_member and voided_at is null;
  result=result||totals||jsonb_build_object('member',m);
 end if;
 return result;
end $$;

create or replace function public.line_page_v2(p_line text,p_name text,p_cursor jsonb default null,p_summary boolean default true) returns jsonb language plpgsql security definer set search_path=public as $$
declare mid uuid; result jsonb; days_data jsonb; more boolean;
begin
 if p_line is null or length(p_line)>100 then raise exception 'LINE 身分不正確'; end if;
 select id into mid from members where line_id=p_line;
 if mid is null then
  insert into members(line_id,display_name) values(p_line,left(coalesce(nullif(p_name,''),'LINE 會員'),100)) on conflict(line_id) do nothing;
  select id into mid from members where line_id=p_line;
 end if;
 select jsonb_build_object('total',coalesce(sum(paid),0),'points',coalesce(sum(earned-redeemed),0),'visits',count(*)) into result from transactions where member_id=mid and voided_at is null;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.day desc),'[]'::jsonb) into days_data from
 (select (occurred_at at time zone 'Asia/Taipei')::date as day,sum(earned) earned from transactions
 where member_id=mid and voided_at is null and earned>0
 and (p_cursor is null or occurred_at<((p_cursor->>'day')::date::timestamp at time zone 'Asia/Taipei'))
 group by 1 order by 1 desc limit 21) x;
 more=jsonb_array_length(days_data)>20; if more then days_data=days_data-20; end if;
 return result||jsonb_build_object('member',(select jsonb_build_object('id',m.id,'display_name',m.display_name) from members m where id=mid),
 'point_days',days_data,'next_day',case when more then days_data->19->>'day' else null end);
end $$;

create or replace function public.admin_detail_v2(p_actor uuid,p_member uuid,p_cursor jsonb default null,p_summary boolean default true) returns jsonb language plpgsql security definer set search_path=public as $$
declare d jsonb;
begin
 perform require_admin_v2(p_actor);
 d=member_page_v2(p_member,p_cursor,20,p_summary);
 if p_summary then d=jsonb_set(d,'{member}',(select to_jsonb(m)-'line_id' from members m where id=p_member)); end if;
 -- Internal notes remain admin-only.
 d=jsonb_set(d,'{transactions}',coalesce((select jsonb_agg(j.value||jsonb_build_object('note',t.note,'void_reason',t.void_reason,'external_id',t.external_id) order by j.ordinality)
 from jsonb_array_elements(d->'transactions') with ordinality j(value,ordinality) join transactions t on t.id=(j.value->>'id')::uuid),'[]'::jsonb));
 return d;
end $$;

create or replace function public.validate_items_v2(p_items jsonb,p_gross integer) returns void language plpgsql set search_path=public as $$
declare item jsonb; total bigint=0; q integer; price integer;
begin
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>50 then raise exception '每筆交易最多 50 個購買項目'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item) is distinct from 'object' or coalesce(length(trim(item->>'name')),0) not between 1 and 100
   or coalesce(item->>'qty','') !~ '^[0-9]+$' or coalesce(item->>'price','') !~ '^[0-9]+$' then raise exception '購買項目名稱、數量或單價格式不正確'; end if;
  q=(item->>'qty')::integer; price=(item->>'price')::integer;
  if q<1 or q>10000 or price<0 or price>10000000 then raise exception '購買項目數量或單價超出範圍'; end if;
  total=total+q::bigint*price;
 end loop;
 if jsonb_array_length(p_items)>0 and total<>p_gross then raise exception '項目小計合計必須等於原金額'; end if;
end $$;

create or replace function public.admin_write_v2(p_actor uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare m members; t transactions; old jsonb; n integer; r integer; dt timestamptz; its jsonb; bal bigint; ext text; tid uuid; note_text text;
begin
 perform require_admin_v2(p_actor);
 select * into m from members where id=(p_data->>'member_id')::uuid for update;
 if not found then raise exception '找不到會員，請用完整會員編號'; end if;
 if p_action='profile' then
  if coalesce(length(trim(p_data->>'display_name')),0) not between 1 and 100 or length(coalesce(p_data->>'phone',''))>30 or length(coalesce(p_data->>'note',''))>1000 then raise exception '會員資料格式不正確'; end if;
  old=to_jsonb(m);
  update members set display_name=trim(p_data->>'display_name'),phone=coalesce(p_data->>'phone',''),note=coalesce(p_data->>'note','') where id=m.id returning * into m;
  insert into audit(actor,action,member_id,old_data,new_data) values(p_actor,p_action,m.id,old,to_jsonb(m));
 elsif p_action='sale' then
  n=(p_data->>'gross')::integer; r=(p_data->>'redeemed')::integer; dt=(p_data->>'occurred_at')::timestamptz;
  its=coalesce(p_data->'items','[]'::jsonb); ext=nullif(trim(p_data->>'external_id'),''); tid=(p_data->>'id')::uuid; note_text=coalesce(p_data->>'note','');
  if n is null or r is null or dt is null or tid is null or n<=0 or n>10000000 or r<0 or r>n or dt>now()+interval '5 minutes' or dt<'2000-01-01'::timestamptz or length(note_text)>1000 or length(ext)>100 then raise exception '交易金額、時間或備註不正確'; end if;
  perform validate_items_v2(its,n);
  select * into t from transactions where id=tid or (ext is not null and external_id=ext) order by (id=tid) desc limit 1;
  if found then
   if t.member_id<>m.id or t.gross<>n or t.redeemed<>r or t.occurred_at<>dt or t.items<>its or t.note<>note_text or t.external_id is distinct from ext then raise exception '重複訂單編號的內容不同，請核對原交易'; end if;
   return jsonb_build_object('id',t.id,'duplicate',true,'earned',t.earned);
  end if;
  select coalesce(sum(earned-redeemed),0) into bal from transactions where member_id=m.id and voided_at is null;
  if r>bal then raise exception '點數餘額不足'; end if;
  insert into transactions(id,member_id,gross,redeemed,occurred_at,note,created_by,items,external_id) values(tid,m.id,n,r,dt,note_text,p_actor,its,ext) returning * into t;
  insert into audit(actor,action,member_id,new_data) values(p_actor,p_action,m.id,to_jsonb(t));
 elsif p_action in ('void','items') then
  select * into t from transactions where id=(p_data->>'id')::uuid and member_id=m.id for update;
  if not found then raise exception '找不到交易'; end if;
  old=to_jsonb(t);
  if p_action='void' then
   if t.voided_at is not null then return jsonb_build_object('id',t.id,'duplicate',true,'earned',t.earned); end if;
   if coalesce(length(trim(p_data->>'reason')),0) not between 1 and 500 then raise exception '請填寫作廢原因'; end if;
   select coalesce(sum(earned-redeemed),0) into bal from transactions where member_id=m.id and voided_at is null;
   if bal-t.earned+t.redeemed<0 then raise exception '點數已被使用，請先處理後續折抵交易'; end if;
   update transactions set voided_at=now(),voided_by=p_actor,void_reason=p_data->>'reason' where id=t.id returning * into t;
  else
   if t.voided_at is not null then raise exception '已作廢交易不能修改項目'; end if;
   its=p_data->'items'; perform validate_items_v2(its,t.gross);
   if jsonb_array_length(its)=0 then raise exception '請至少填寫一個項目'; end if;
   update transactions set items=its where id=t.id returning * into t;
  end if;
  insert into audit(actor,action,member_id,old_data,new_data) values(p_actor,p_action,m.id,old,to_jsonb(t));
 else raise exception '不支援的操作'; end if;
 return jsonb_build_object('id',t.id,'duplicate',false,'earned',t.earned);
end $$;

create or replace function public.admin_members_v2(p_actor uuid,p_query text default '',p_offset integer default 0) returns jsonb language plpgsql security definer set search_path=public as $$
declare q text=left(trim(coalesce(p_query,'')),100); rows_data jsonb; off integer=greatest(0,p_offset);
begin
 perform require_admin_v2(p_actor);
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]'::jsonb) into rows_data from
 (select id,display_name,phone,note,created_at from members where q='' or id::text=q or strpos(lower(display_name),lower(q))>0 or strpos(phone,q)>0 order by created_at desc,id offset off limit 51) x;
 return jsonb_build_object('rows',case when jsonb_array_length(rows_data)>50 then rows_data-50 else rows_data end,'has_more',jsonb_array_length(rows_data)>50);
end $$;

create or replace function public.month_bounds_v2(p_month text) returns table(start_at timestamptz,end_at timestamptz,previous_at timestamptz) language plpgsql set search_path=public as $$
declare d date;
begin
 if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception '月份格式應為 YYYY-MM'; end if;
 d=(p_month||'-01')::date;
 return query select d::timestamp at time zone 'Asia/Taipei',(d+interval '1 month') at time zone 'Asia/Taipei',(d-interval '1 month') at time zone 'Asia/Taipei';
end $$;

create or replace function public.admin_report_v2(p_actor uuid,p_month text) returns jsonb language plpgsql security definer set search_path=public as $$
declare st timestamptz; en timestamptz; prev timestamptz; result jsonb;
begin
 perform require_admin_v2(p_actor); select start_at,end_at,previous_at into st,en,prev from month_bounds_v2(p_month);
 with src as materialized (select member_id,paid,earned,redeemed,occurred_at from transactions where voided_at is null and occurred_at>=prev and occurred_at<en),
 cur as (select * from src where occurred_at>=st),
 summary as (select jsonb_build_object('paid',coalesce(sum(paid),0),'earned',coalesce(sum(earned),0),'redeemed',coalesce(sum(redeemed),0),'visits',count(*),'customers',count(distinct member_id),'average',coalesce(round(avg(paid),2),0)) d from cur),
 previous as (select jsonb_build_object('paid',coalesce(sum(paid),0),'earned',coalesce(sum(earned),0),'redeemed',coalesce(sum(redeemed),0),'visits',count(*),'customers',count(distinct member_id),'average',coalesce(round(avg(paid),2),0)) d from src where occurred_at<st),
 days as (select generate_series((st at time zone 'Asia/Taipei')::date,((en at time zone 'Asia/Taipei')::date-1),interval '1 day')::date d),
 daily as (select (occurred_at at time zone 'Asia/Taipei')::date d,sum(paid) paid,sum(earned) earned,sum(redeemed) redeemed,count(*) visits from cur group by 1),
 daily_rows as (select days.d as day,coalesce(paid,0) paid,coalesce(earned,0) earned,coalesce(redeemed,0) redeemed,coalesce(visits,0) visits from days left join daily using(d)),
 counts as (select member_id,count(*) n from cur group by member_id)
 select jsonb_build_object('month',p_month,'current',(select d from summary),'previous',(select d from previous),
 'days',(select jsonb_agg(to_jsonb(daily_rows) order by day) from daily_rows),
 'frequency',jsonb_build_array(jsonb_build_object('label','消費 1 次','value',(select count(*) from counts where n=1)),jsonb_build_object('label','消費 2 次','value',(select count(*) from counts where n=2)),jsonb_build_object('label','消費 3 次以上','value',(select count(*) from counts where n>=3)))) into result;
 return result;
end $$;

create or replace function public.admin_compare_v2(p_actor uuid,p_month text,p_offset integer default 0,p_sort text default 'paid') returns jsonb language plpgsql security definer set search_path=public as $$
declare st timestamptz; en timestamptz; prev timestamptz; rows_data jsonb;
begin
 perform require_admin_v2(p_actor); select start_at,end_at,previous_at into st,en,prev from month_bounds_v2(p_month);
 with per as (select member_id,coalesce(sum(paid) filter(where occurred_at>=st),0) paid,coalesce(sum(paid) filter(where occurred_at<st),0) previous_paid,
 count(*) filter(where occurred_at>=st) visits,count(*) filter(where occurred_at<st) previous_visits,
 coalesce(sum(earned) filter(where occurred_at>=st),0) earned from transactions where voided_at is null and occurred_at>=prev and occurred_at<en group by member_id),
 ranked as (select m.id,m.display_name,m.phone,per.paid,per.previous_paid,per.visits,per.previous_visits,per.earned,per.paid-per.previous_paid paid_diff,per.visits-per.previous_visits visits_diff from per join members m on m.id=member_id),
 page as (select * from ranked order by case when p_sort='visits' then visits else paid end desc,id offset greatest(0,p_offset) limit 51)
 select coalesce(jsonb_agg(to_jsonb(page) order by case when p_sort='visits' then visits else paid end desc,id),'[]'::jsonb) into rows_data from page;
 return jsonb_build_object('rows',case when jsonb_array_length(rows_data)>50 then rows_data-50 else rows_data end,'has_more',jsonb_array_length(rows_data)>50);
end $$;

create or replace function public.admin_export_v2(p_actor uuid,p_month text,p_cursor jsonb default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare st timestamptz; en timestamptz; prev timestamptz; rows_data jsonb; last_row jsonb; more boolean;
begin
 perform require_admin_v2(p_actor); select start_at,end_at,previous_at into st,en,prev from month_bounds_v2(p_month);
 select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc,x.id desc),'[]'::jsonb) into rows_data from
 (select t.id,t.member_id,m.display_name,m.phone,t.gross,t.redeemed,t.paid,t.earned,t.occurred_at,t.items,t.note,t.external_id,t.voided_at,t.void_reason from transactions t join members m on m.id=t.member_id where t.occurred_at>=st and t.occurred_at<en and (p_cursor is null or (t.occurred_at,t.id)<((p_cursor->>'at')::timestamptz,(p_cursor->>'id')::uuid)) order by t.occurred_at desc,t.id desc limit 201) x;
 more=jsonb_array_length(rows_data)>200; if more then rows_data=rows_data-200; end if;
 last_row=rows_data->(jsonb_array_length(rows_data)-1);
 return jsonb_build_object('rows',rows_data,'next',case when more then jsonb_build_object('at',last_row->>'occurred_at','id',last_row->>'id') else null end);
end $$;

create or replace function public.admin_import_v2(p_actor uuid,p_rows jsonb,p_dry boolean default true) returns jsonb language plpgsql security definer set search_path=public as $$
declare row_data jsonb; result jsonb='[]'::jsonb; receipt jsonb; mid uuid; n integer=0; dup integer=0;
begin
 perform require_admin_v2(p_actor);
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 200 then raise exception '每次匯入限 1～200 筆訂單'; end if;
 if exists(select 1 from jsonb_array_elements(p_rows) j group by j->>'external_id' having count(*)>1) then raise exception '匯入訂單編號重複'; end if;
 -- Acquire every affected member in a deterministic order to prevent overspending/deadlocks.
 for mid in select distinct (value->>'member_id')::uuid from jsonb_array_elements(p_rows) order by 1 loop
  perform 1 from members where id=mid for update;
  if not found then raise exception '匯入會員不存在：%',mid; end if;
 end loop;
 begin
  for row_data in select value from jsonb_array_elements(p_rows) order by (value->>'member_id')::uuid,(value->>'occurred_at')::timestamptz,value->>'external_id' loop
   if nullif(trim(row_data->>'external_id'),'') is null then raise exception '匯入需要唯一訂單編號'; end if;
   if jsonb_typeof(row_data->'items') is distinct from 'array' or jsonb_array_length(row_data->'items')=0 then raise exception '匯入需要購買項目'; end if;
   receipt=admin_write_v2(p_actor,'sale',row_data);
   if (receipt->>'duplicate')::boolean then dup=dup+1; else n=n+1; end if;
   result=result||jsonb_build_array(jsonb_build_object('external_id',row_data->>'external_id')||receipt);
  end loop;
  if p_dry then raise exception 'preview rollback' using errcode='PZ001'; end if;
 exception when sqlstate 'PZ001' then null;
 end;
 return jsonb_build_object('dry_run',p_dry,'created',n,'duplicates',dup,'results',result);
end $$;

-- Restrict ALL v2 helpers and APIs to server credentials, including newly created functions.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('require_admin_v2','member_page_v2','line_page_v2','admin_detail_v2','validate_items_v2','admin_write_v2','admin_members_v2','month_bounds_v2','admin_report_v2','admin_compare_v2','admin_export_v2','admin_import_v2') loop
  execute format('revoke all on function %s from public, anon, authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
notify pgrst, 'reload schema';
commit;
