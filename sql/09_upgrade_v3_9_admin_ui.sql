-- v3.9.0 管理端 UI / 商品庫存 / 全店客訂 / 店員管理
-- 請先完成 08_upgrade_v3_8_custom_orders.sql，再執行本檔。
begin;

alter table public.custom_orders add column if not exists note text not null default '' check(length(note)<=1000);


create or replace function public.admin_custom_orders_v39(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  mid uuid; oid uuid; o custom_orders; old jsonb; pname text; sname text; dt timestamptz; dep integer; result jsonb; q text; lim integer;
begin
  perform require_admin_v2(p_actor);
  mid=nullif(p_data->>'member_id','')::uuid;
  if p_action='list' then
    if mid is null or not exists(select 1 from members where id=mid) then raise exception '找不到會員'; end if;
    return jsonb_build_object(
      'orders',(select coalesce(jsonb_agg(to_jsonb(x) order by x.paid_in_full asc,x.ordered_at desc,x.id desc),'[]'::jsonb) from
        (select id,member_id,ordered_at,product_name,deposit_amount,deposit_paid,paid_in_full,staff_name,notified,notified_at,note,created_at,updated_at
         from custom_orders where member_id=mid order by paid_in_full asc,ordered_at desc,id desc limit 200) x),
      'staff',(select coalesce(jsonb_agg(name order by name),'[]'::jsonb) from staff_options where active)
    );
  elsif p_action='global' then
    q=left(trim(coalesce(p_data->>'query','')),200); lim=least(300,greatest(1,coalesce(nullif(p_data->>'limit','')::integer,200)));
    return jsonb_build_object(
      'orders',(select coalesce(jsonb_agg(to_jsonb(x) order by x.paid_in_full asc,x.notified asc,x.ordered_at desc,x.id desc),'[]'::jsonb) from
        (select o.id,o.member_id,m.display_name,m.phone,o.ordered_at,o.product_name,o.deposit_amount,o.deposit_paid,o.paid_in_full,o.staff_name,o.notified,o.notified_at,o.note,o.created_at,o.updated_at
         from custom_orders o join members m on m.id=o.member_id
         where q='' or m.display_name ilike '%'||q||'%' or coalesce(m.phone,'') ilike '%'||q||'%' or o.product_name ilike '%'||q||'%'
         order by o.paid_in_full asc,o.notified asc,o.ordered_at desc,o.id desc limit lim) x),
      'staff',(select coalesce(jsonb_agg(name order by name),'[]'::jsonb) from staff_options where active)
    );
  elsif p_action='staff_list' then
    return jsonb_build_object('staff',(select coalesce(jsonb_agg(to_jsonb(s) order by active desc,name),'[]'::jsonb) from (select name,active,created_at from staff_options) s));
  elsif p_action='staff_add' then
    sname=trim(coalesce(p_data->>'name',''));
    if length(sname) not between 1 and 60 then raise exception '店員名字需為 1～60 個字'; end if;
    insert into staff_options(name,created_by) values(sname,p_actor) on conflict(name) do update set active=true;
    insert into audit(actor,action,new_data) values(p_actor,'staff_enable',jsonb_build_object('name',sname));
    return jsonb_build_object('name',sname,'active',true);
  elsif p_action='staff_set' then
    sname=trim(coalesce(p_data->>'name',''));
    if not exists(select 1 from staff_options where name=sname) then raise exception '找不到店員'; end if;
    update staff_options set active=coalesce((p_data->>'active')::boolean,active) where name=sname;
    insert into audit(actor,action,new_data) values(p_actor,'staff_set',jsonb_build_object('name',sname,'active',coalesce((p_data->>'active')::boolean,true)));
    return jsonb_build_object('name',sname,'active',(select active from staff_options where name=sname));
  elsif p_action='create' then
    if mid is null or not exists(select 1 from members where id=mid) then raise exception '找不到會員'; end if;
    pname=trim(coalesce(p_data->>'product_name','')); sname=trim(coalesce(p_data->>'staff_name',''));
    if length(pname) not between 1 and 200 then raise exception '請輸入客訂品名（最多 200 字）'; end if;
    if length(sname)>60 then raise exception '店員名字過長'; end if;
    if length(coalesce(p_data->>'note',''))>1000 then raise exception '客訂備註過長'; end if;
    dep=coalesce(nullif(p_data->>'deposit_amount','')::integer,0); if dep<0 or dep>10000000 then raise exception '訂金金額不正確'; end if;
    dt=coalesce(nullif(p_data->>'ordered_at','')::timestamptz,now());
    insert into custom_orders(member_id,ordered_at,product_name,deposit_amount,deposit_paid,paid_in_full,staff_name,notified,notified_at,notified_by,note,created_by)
    values(mid,dt,pname,dep,coalesce((p_data->>'deposit_paid')::boolean,false),coalesce((p_data->>'paid_in_full')::boolean,false),sname,
      coalesce((p_data->>'notified')::boolean,false),case when coalesce((p_data->>'notified')::boolean,false) then now() end,case when coalesce((p_data->>'notified')::boolean,false) then p_actor end,coalesce(p_data->>'note',''),p_actor)
    returning * into o;
    if sname<>'' then insert into staff_options(name,created_by) values(sname,p_actor) on conflict(name) do update set active=true; end if;
    insert into audit(actor,action,member_id,new_data) values(p_actor,'custom_order_create',mid,to_jsonb(o)); return to_jsonb(o);
  elsif p_action='update' then
    oid=(p_data->>'id')::uuid; select * into o from custom_orders where id=oid and member_id=mid for update;
    if not found then raise exception '找不到客訂資料'; end if; old=to_jsonb(o);
    pname=trim(coalesce(p_data->>'product_name',o.product_name)); sname=trim(coalesce(p_data->>'staff_name',o.staff_name));
    if length(pname) not between 1 and 200 or length(sname)>60 or length(coalesce(p_data->>'note',o.note))>1000 then raise exception '客訂資料格式不正確'; end if;
    dep=coalesce(nullif(p_data->>'deposit_amount','')::integer,o.deposit_amount); if dep<0 or dep>10000000 then raise exception '訂金金額不正確'; end if;
    update custom_orders set ordered_at=coalesce(nullif(p_data->>'ordered_at','')::timestamptz,ordered_at), product_name=pname, deposit_amount=dep,
      deposit_paid=coalesce((p_data->>'deposit_paid')::boolean,deposit_paid), paid_in_full=coalesce((p_data->>'paid_in_full')::boolean,paid_in_full), staff_name=sname,
      notified=coalesce((p_data->>'notified')::boolean,notified),
      notified_at=case when coalesce((p_data->>'notified')::boolean,notified) then coalesce(notified_at,now()) else null end,
      notified_by=case when coalesce((p_data->>'notified')::boolean,notified) then coalesce(notified_by,p_actor) else null end,
      note=coalesce(p_data->>'note',note),updated_at=now() where id=oid returning * into o;
    if sname<>'' then insert into staff_options(name,created_by) values(sname,p_actor) on conflict(name) do update set active=true; end if;
    insert into audit(actor,action,member_id,old_data,new_data) values(p_actor,'custom_order_update',mid,old,to_jsonb(o)); return to_jsonb(o);
  elsif p_action='delete' then
    oid=(p_data->>'id')::uuid; select * into o from custom_orders where id=oid and member_id=mid for update;
    if not found then raise exception '找不到客訂資料'; end if; delete from custom_orders where id=oid;
    insert into audit(actor,action,member_id,old_data) values(p_actor,'custom_order_delete',mid,to_jsonb(o)); return jsonb_build_object('deleted',true,'id',oid);
  elsif p_action='notify_target' then
    oid=(p_data->>'id')::uuid; select * into o from custom_orders where id=oid and member_id=mid;
    if not found then raise exception '找不到客訂資料'; end if;
    select jsonb_build_object('line_id',m.line_id,'display_name',m.display_name,'order',jsonb_build_object('id',o.id,'product_name',o.product_name,'deposit_amount',o.deposit_amount,'deposit_paid',o.deposit_paid,'paid_in_full',o.paid_in_full,'staff_name',o.staff_name)) into result from members m where m.id=mid; return result;
  elsif p_action='notify_mark' then
    oid=(p_data->>'id')::uuid; select * into o from custom_orders where id=oid and member_id=mid for update;
    if not found then raise exception '找不到客訂資料'; end if; old=to_jsonb(o);
    update custom_orders set notified=true,notified_at=now(),notified_by=p_actor,updated_at=now() where id=oid returning * into o;
    insert into audit(actor,action,member_id,old_data,new_data) values(p_actor,'custom_order_notify',mid,old,to_jsonb(o)); return to_jsonb(o);
  else raise exception '不支援的客訂操作'; end if;
end $$;


create or replace function public.admin_health_v39(p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 perform require_admin_v2(p_actor);
 return jsonb_build_object('schema_version','3.9.1','checked_at',now(),'custom_orders_open',(select count(*) from custom_orders where not paid_in_full));
end $$;

create or replace function public.admin_backup_v39(p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 perform require_admin_v2(p_actor);
 lock table admins,members,transactions,audit,staff_options,custom_orders in share mode;
 if (select coalesce(sum(pg_column_size(t)),0) from transactions t)+(select coalesce(sum(pg_column_size(a)),0) from audit a)+(select coalesce(sum(pg_column_size(m)),0) from members m)+(select coalesce(sum(pg_column_size(o)),0) from custom_orders o)>2500000 then raise exception '資料超過網頁備份容量，請依手冊使用資料庫備份'; end if;
 select jsonb_build_object('format','line-member-business','version',4,'created_at',now(),
  'admins',(select coalesce(jsonb_agg(to_jsonb(t) order by user_id),'[]'::jsonb) from admins t),
  'members',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from members t),
  'transactions',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from transactions t),
  'audit',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from audit t),
  'staff_options',(select coalesce(jsonb_agg(to_jsonb(t) order by name),'[]'::jsonb) from staff_options t),
  'custom_orders',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from custom_orders t),
  'points',(select coalesce(sum(earned-redeemed),0) from transactions where voided_at is null)) into result;
 if octet_length(result::text)>3000000 then raise exception '資料超過網頁備份容量，請依手冊使用資料庫備份'; end if; return result;
end $$;

revoke all on function public.admin_custom_orders_v39(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.admin_custom_orders_v39(uuid,text,jsonb) to service_role;
revoke all on function public.admin_health_v39(uuid) from public,anon,authenticated;
grant execute on function public.admin_health_v39(uuid) to service_role;
revoke all on function public.admin_backup_v39(uuid) from public,anon,authenticated;
grant execute on function public.admin_backup_v39(uuid) to service_role;
notify pgrst, 'reload schema';
commit;
