-- v3.9.3 安全修復：會員詳細資料 DB-RPC
-- 不刪除會員、不刪除交易。可重複執行。
begin;

-- 確保 v2 會員詳細資料 RPC 會使用到的欄位存在。
alter table public.transactions add column if not exists items jsonb not null default '[]'::jsonb;
alter table public.transactions add column if not exists external_id text;
create unique index if not exists transactions_external_id_unique
  on public.transactions(external_id) where external_id is not null;
create index if not exists transactions_member_page
  on public.transactions(member_id,occurred_at desc,id desc);

-- 管理權限檢查（保留原本 admins 權限模式）。
create or replace function public.require_admin_v2(p_actor uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 if p_actor is null or not exists(select 1 from admins where user_id=p_actor) then
   raise exception '沒有管理權限' using errcode='42501';
 end if;
end $$;

-- 直接重建會員詳細資料 RPC，不再串接舊版 member_page_v2，降低版本相依。
create or replace function public.admin_detail_v2(
  p_actor uuid,
  p_member uuid,
  p_cursor jsonb default null,
  p_summary boolean default true
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  result jsonb;
  member_data jsonb;
  rows_data jsonb;
  totals jsonb;
  last_row jsonb;
  more boolean := false;
begin
  perform require_admin_v2(p_actor);

  select to_jsonb(m)-'line_id'
    into member_data
  from members m
  where m.id=p_member;

  if member_data is null then
    raise exception '找不到會員';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc,x.id desc),'[]'::jsonb)
    into rows_data
  from (
    select t.id,t.gross,t.redeemed,t.paid,t.earned,t.occurred_at,t.voided_at,
           coalesce(t.items,'[]'::jsonb) as items,
           coalesce(t.note,'') as note,
           t.void_reason,t.external_id
    from transactions t
    where t.member_id=p_member
      and (
        p_cursor is null
        or (t.occurred_at,t.id) < (
          (p_cursor->>'at')::timestamptz,
          (p_cursor->>'id')::uuid
        )
      )
    order by t.occurred_at desc,t.id desc
    limit 21
  ) x;

  more := jsonb_array_length(rows_data)>20;
  if more then rows_data := rows_data-20; end if;

  if jsonb_array_length(rows_data)>0 then
    last_row := rows_data->(jsonb_array_length(rows_data)-1);
  end if;

  result := jsonb_build_object(
    'transactions', rows_data,
    'next', case when more then jsonb_build_object('at',last_row->>'occurred_at','id',last_row->>'id') else null end
  );

  if p_summary then
    select jsonb_build_object(
      'total',coalesce(sum(t.paid) filter(where t.voided_at is null),0),
      'points',coalesce(sum(t.earned-t.redeemed) filter(where t.voided_at is null),0),
      'visits',count(*) filter(where t.voided_at is null)
    ) into totals
    from transactions t where t.member_id=p_member;

    result := result || totals || jsonb_build_object('member',member_data);
  end if;

  return result;
end $$;

-- 會員列表 RPC 一併重建，避免舊資料庫版本差異。
create or replace function public.admin_members_v2(
  p_actor uuid,p_query text default '',p_offset integer default 0
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  q text=left(trim(coalesce(p_query,'')),100);
  rows_data jsonb;
  off integer=greatest(0,p_offset);
begin
  perform require_admin_v2(p_actor);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]'::jsonb)
    into rows_data
  from (
    select id,display_name,phone,note,created_at
    from members
    where q='' or id::text=q or strpos(lower(display_name),lower(q))>0 or strpos(phone,q)>0
    order by created_at desc,id
    offset off limit 51
  ) x;
  return jsonb_build_object(
    'rows',case when jsonb_array_length(rows_data)>50 then rows_data-50 else rows_data end,
    'has_more',jsonb_array_length(rows_data)>50
  );
end $$;

revoke all on function public.require_admin_v2(uuid) from public,anon,authenticated;
grant execute on function public.require_admin_v2(uuid) to service_role;
revoke all on function public.admin_detail_v2(uuid,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.admin_detail_v2(uuid,uuid,jsonb,boolean) to service_role;
revoke all on function public.admin_members_v2(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.admin_members_v2(uuid,text,integer) to service_role;

notify pgrst, 'reload schema';
commit;
