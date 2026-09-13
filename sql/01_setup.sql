-- Execute ONCE in a NEW Supabase project. All business access goes through the server.
begin;
create table public.admins(user_id uuid primary key references auth.users(id));
create table public.members(id uuid primary key default gen_random_uuid(), line_id text unique not null, display_name text not null, phone text not null default '', note text not null default '', created_at timestamptz not null default now());
create table public.transactions(id uuid primary key, member_id uuid not null references public.members(id), gross integer not null check(gross>0 and gross<=10000000), redeemed integer not null check(redeemed>=0 and redeemed<=gross), paid integer generated always as (gross-redeemed) stored, earned integer generated always as (((gross-redeemed)/100)*10) stored, occurred_at timestamptz not null, note text not null default '', created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), voided_at timestamptz, voided_by uuid references auth.users(id), void_reason text);
create index on public.transactions(member_id, occurred_at desc);
create table public.audit(id bigint generated always as identity primary key, actor uuid references auth.users(id), action text not null, member_id uuid not null, old_data jsonb, new_data jsonb, created_at timestamptz not null default now());
alter table public.admins enable row level security;
alter table public.members enable row level security;
alter table public.transactions enable row level security;
alter table public.audit enable row level security;
revoke all on public.admins, public.members, public.transactions, public.audit from anon, authenticated;
grant all on public.admins, public.members, public.transactions, public.audit to service_role;
grant usage, select on all sequences in schema public to service_role;
create function public.member_snapshot(p_member uuid) returns jsonb language sql security definer set search_path=public as $$
select jsonb_build_object('member', to_jsonb(m)-'line_id'-'note','total',coalesce((select sum(paid) from transactions where member_id=m.id and voided_at is null),0),'points',coalesce((select sum(earned-redeemed) from transactions where member_id=m.id and voided_at is null),0),'transactions',coalesce((select jsonb_agg(x order by x.occurred_at desc) from (select id,gross,redeemed,paid,earned,occurred_at,voided_at from transactions where member_id=m.id order by occurred_at desc limit 500) x),'[]'::jsonb)) from members m where m.id=p_member;
$$;
create function public.admin_action(p_actor uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare m members; t transactions; bal bigint; before_data jsonb; n integer; r integer; occurred timestamptz;
begin
 if not exists(select 1 from admins where user_id=p_actor) then raise exception '沒有管理權限'; end if;
 select * into m from members where id=(p_data->>'member_id')::uuid for update;
 if not found then raise exception '找不到會員'; end if;
 if p_action='profile' then
  if length(trim(p_data->>'display_name')) not between 1 and 100 or length(coalesce(p_data->>'phone',''))>30 or length(coalesce(p_data->>'note',''))>1000 then raise exception '資料格式不正確'; end if;
  before_data=to_jsonb(m);
  update members set display_name=trim(p_data->>'display_name'),phone=coalesce(p_data->>'phone',''),note=coalesce(p_data->>'note','') where id=m.id returning * into m;
  insert into audit(actor,action,member_id,old_data,new_data) values(p_actor,p_action,m.id,before_data,to_jsonb(m));
 elsif p_action='sale' then
  select * into t from transactions where id=(p_data->>'id')::uuid;
  if found then
   if t.member_id<>m.id or t.gross<>(p_data->>'gross')::integer or t.redeemed<>(p_data->>'redeemed')::integer then raise exception '交易識別碼重複'; end if;
   return member_snapshot(m.id);
  end if;
  n=(p_data->>'gross')::integer; r=(p_data->>'redeemed')::integer; occurred=(p_data->>'occurred_at')::timestamptz;
  if n is null or r is null or occurred is null or n<=0 or n>10000000 or r<0 or r>n or occurred>now()+interval '5 minutes' or length(coalesce(p_data->>'note',''))>1000 then raise exception '金額、時間或備註不正確'; end if;
  select coalesce(sum(earned-redeemed),0) into bal from transactions where member_id=m.id and voided_at is null;
  if r>bal then raise exception '點數餘額不足'; end if;
  insert into transactions(id,member_id,gross,redeemed,occurred_at,note,created_by) values((p_data->>'id')::uuid,m.id,n,r,occurred,coalesce(p_data->>'note',''),p_actor) returning * into t;
  insert into audit(actor,action,member_id,new_data) values(p_actor,p_action,m.id,to_jsonb(t));
 elsif p_action='void' then
  select * into t from transactions where id=(p_data->>'id')::uuid and member_id=m.id for update;
  if not found then raise exception '找不到交易'; end if;
  if t.voided_at is not null then return member_snapshot(m.id); end if;
  if length(trim(coalesce(p_data->>'reason',''))) not between 1 and 500 then raise exception '請填寫作廢原因'; end if;
  select coalesce(sum(earned-redeemed),0) into bal from transactions where member_id=m.id and voided_at is null;
  if bal-t.earned+t.redeemed<0 then raise exception '點數已被使用，請先處理後續折抵交易'; end if;
  before_data=to_jsonb(t);
  update transactions set voided_at=now(),voided_by=p_actor,void_reason=p_data->>'reason' where id=t.id returning * into t;
  insert into audit(actor,action,member_id,old_data,new_data) values(p_actor,p_action,m.id,before_data,to_jsonb(t));
 else raise exception '不支援的操作'; end if;
 return member_snapshot(m.id);
end $$;
revoke all on function public.member_snapshot(uuid) from public,anon,authenticated;
revoke all on function public.admin_action(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.member_snapshot(uuid),public.admin_action(uuid,text,jsonb) to service_role;
commit;
