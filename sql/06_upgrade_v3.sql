-- V3 additive migration. Run 04 first. Does not delete or rewrite business data.
begin;
create index if not exists audit_member_page_v3 on public.audit(member_id,id desc);
create index if not exists audit_page_v3 on public.audit(id desc);
create or replace function public.period_bounds_v3(p_month text,p_mode text default 'same')
returns table(start_at timestamptz,end_at timestamptz,previous_at timestamptz,previous_end timestamptz)
language plpgsql stable set search_path=public as $$
declare st timestamptz; en timestamptz; pr timestamptz; pe timestamptz; today date=(now() at time zone 'Asia/Taipei')::date; days integer;
begin
 if p_mode not in ('same','full') or p_mode is null then raise exception '比較模式不正確'; end if;
 select b.start_at,b.end_at,b.previous_at into st,en,pr from month_bounds_v2(p_month) b;
 pe=st;
 if p_mode='same' and p_month=to_char(today,'YYYY-MM') then
  days=extract(day from today)::integer;
  en=(today+1)::timestamp at time zone 'Asia/Taipei';
  pe=least(st,((pr at time zone 'Asia/Taipei')+make_interval(days=>days)) at time zone 'Asia/Taipei');
 end if;
 return query select st,en,pr,pe;
end $$;
create or replace function public.admin_report_v3(p_actor uuid,p_month text,p_mode text default 'same') returns jsonb language plpgsql security definer set search_path=public as $$
declare st timestamptz; en timestamptz; prev timestamptz; pen timestamptz; result jsonb;
begin
 perform require_admin_v2(p_actor); select start_at,end_at,previous_at,previous_end into st,en,prev,pen from period_bounds_v3(p_month,p_mode);
 with src as materialized (select member_id,paid,earned,redeemed,occurred_at from transactions where voided_at is null and ((occurred_at>=st and occurred_at<en) or (occurred_at>=prev and occurred_at<pen))),
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
 result=result||jsonb_build_object('products',(select coalesce(jsonb_agg(to_jsonb(x) order by x.quantity desc,x.name),'[]'::jsonb) from
 (select i->>'name' name,sum((i->>'qty')::bigint) quantity,sum((i->>'qty')::bigint*(i->>'price')::bigint) gross
 from transactions t cross join lateral jsonb_array_elements(t.items) i where t.voided_at is null and t.occurred_at>=st and t.occurred_at<en group by 1 order by quantity desc,name limit 20) x),
 'customer_types',(with firsts as (select member_id,min(occurred_at) first_at from transactions where voided_at is null group by member_id), active as (select distinct member_id from transactions where voided_at is null and occurred_at>=st and occurred_at<en)
 select jsonb_build_object('new',count(*) filter(where first_at>=st),'returning',count(*) filter(where first_at<st)) from active join firsts using(member_id)));
 return result||jsonb_build_object('start_at',st,'end_at',en,'previous_at',prev,'previous_end',pen,'mode',p_mode,'generated_at',now());
end $$;

create or replace function public.admin_compare_v3(p_actor uuid,p_month text,p_offset integer default 0,p_sort text default 'paid',p_mode text default 'same') returns jsonb language plpgsql security definer set search_path=public as $$
declare st timestamptz; en timestamptz; prev timestamptz; pen timestamptz; rows_data jsonb;
begin
 perform require_admin_v2(p_actor); select start_at,end_at,previous_at,previous_end into st,en,prev,pen from period_bounds_v3(p_month,p_mode);
 with per as (select member_id,coalesce(sum(paid) filter(where occurred_at>=st),0) paid,coalesce(sum(paid) filter(where occurred_at<st),0) previous_paid,
 count(*) filter(where occurred_at>=st) visits,count(*) filter(where occurred_at<st) previous_visits,
 coalesce(sum(earned) filter(where occurred_at>=st),0) earned from transactions where voided_at is null and ((occurred_at>=st and occurred_at<en) or (occurred_at>=prev and occurred_at<pen)) group by member_id),
 ranked as (select m.id,m.display_name,m.phone,per.paid,per.previous_paid,per.visits,per.previous_visits,per.earned,per.paid-per.previous_paid paid_diff,per.visits-per.previous_visits visits_diff from per join members m on m.id=member_id),
 page as (select * from ranked order by case when p_sort='visits' then visits else paid end desc,id offset greatest(0,p_offset) limit 51)
 select coalesce(jsonb_agg(to_jsonb(page) order by case when p_sort='visits' then visits else paid end desc,id),'[]'::jsonb) into rows_data from page;
 return jsonb_build_object('rows',case when jsonb_array_length(rows_data)>50 then rows_data-50 else rows_data end,'has_more',jsonb_array_length(rows_data)>50);
end $$;


create or replace function public.admin_operations_v3(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb; rows_data jsonb; last_row jsonb; mid uuid=(p_data->>'member_id')::uuid;
begin
 perform require_admin_v2(p_actor);
 if p_action='health' then return jsonb_build_object('schema_version','3.0.0','checked_at',now());
 elsif p_action='audit' then
  select coalesce(jsonb_agg(to_jsonb(x) order by x.id desc),'[]'::jsonb) into rows_data from
  (select a.id,a.actor,u.email,a.action,a.member_id,m.display_name,a.old_data-'line_id' old_data,a.new_data-'line_id' new_data,a.created_at
   from audit a left join auth.users u on u.id=a.actor left join members m on m.id=a.member_id
   where (mid is null or a.member_id=mid) and (p_data->>'before' is null or a.id<(p_data->>'before')::bigint)
   order by a.id desc limit 51) x;
 elsif p_action='ledger' then
  if mid is null then raise exception '請選擇會員'; end if;
  with events as (
   select a.id,a.created_at,a.action,a.actor,
    case when action='sale' then coalesce((new_data->>'earned')::bigint,0) when action='void' then -coalesce((old_data->>'earned')::bigint,0) else 0 end earned,
    case when action='sale' then -coalesce((new_data->>'redeemed')::bigint,0) when action='void' then coalesce((old_data->>'redeemed')::bigint,0) else 0 end redeemed,
    coalesce(new_data->>'id',old_data->>'id') transaction_id,coalesce(new_data->>'void_reason','') reason
   from audit a where member_id=mid and action in ('sale','void')),
  running as (select *,sum(earned+redeemed) over(order by id rows unbounded preceding) balance from events)
  select coalesce(jsonb_agg(to_jsonb(x) order by id desc),'[]'::jsonb) into rows_data from
  (select * from running where p_data->>'before' is null or id<(p_data->>'before')::bigint order by id desc limit 51) x;
 elsif p_action='reconcile' then
  with tx as (select member_id,sum(earned) earned,sum(redeemed) redeemed,sum(earned-redeemed) points,count(*) visits from transactions where voided_at is null group by 1),
  log as (select member_id,sum(case when action='sale' then coalesce((new_data->>'earned')::bigint,0)-coalesce((new_data->>'redeemed')::bigint,0) when action='void' then -coalesce((old_data->>'earned')::bigint,0)+coalesce((old_data->>'redeemed')::bigint,0) else 0 end) points from audit group by 1),
  per as (select m.id,m.display_name,coalesce(t.earned,0) earned,coalesce(t.redeemed,0) redeemed,coalesce(t.points,0) points,coalesce(l.points,0) ledger_points,coalesce(t.points,0)-coalesce(l.points,0) difference from members m left join tx t on t.member_id=m.id left join log l on l.member_id=m.id),
  page as (select * from per order by abs(difference) desc,id offset greatest(0,coalesce((p_data->>'offset')::integer,0)) limit 51)
  select jsonb_build_object('rows',(select coalesce(jsonb_agg(to_jsonb(page) order by abs(difference) desc,id),'[]'::jsonb) from page),'total_points',(select coalesce(sum(points),0) from per),'difference_count',(select count(*) from per where difference<>0),'negative_count',(select count(*) from per where points<0),'checked_at',now()) into result;
  rows_data=result->'rows'; return result||jsonb_build_object('rows',case when jsonb_array_length(rows_data)>50 then rows_data-50 else rows_data end,'has_more',jsonb_array_length(rows_data)>50);
 elsif p_action='backup' then
  -- Lock against concurrent writes for one coherent business snapshot.
  lock table admins,members,transactions,audit in share mode;
  if (select coalesce(sum(pg_column_size(t)),0) from transactions t)+(select coalesce(sum(pg_column_size(a)),0) from audit a)+(select coalesce(sum(pg_column_size(m)),0) from members m)>2500000 then
   raise exception '資料超過網頁備份容量，請依手冊使用資料庫備份';
  end if;
  select jsonb_build_object('format','line-member-business','version',3,'created_at',now(),
   'admins',(select coalesce(jsonb_agg(to_jsonb(t) order by user_id),'[]'::jsonb) from admins t),
   'members',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from members t),
   'transactions',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from transactions t),
   'audit',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from audit t),
   'points',(select coalesce(sum(earned-redeemed),0) from transactions where voided_at is null)) into result;
  if octet_length(result::text)>3000000 then raise exception '資料超過網頁備份容量，請依手冊使用資料庫備份'; end if;
  return result;
 else raise exception '不支援的操作'; end if;
 last_row=rows_data->49;
 return jsonb_build_object('rows',case when jsonb_array_length(rows_data)>50 then rows_data-50 else rows_data end,'next',case when jsonb_array_length(rows_data)>50 then last_row->>'id' else null end);
end $$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('period_bounds_v3','admin_report_v3','admin_compare_v3','admin_operations_v3') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
notify pgrst, 'reload schema';
commit;
