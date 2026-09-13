-- Existing 5% or 10% database: preserve past rewards; new sales earn 10 points per NT$100.
-- Run on the existing V3 database while checkout is paused. Safe to repeat.
begin;
lock table public.transactions in access exclusive mode;
do $$
declare expression text; previous_rate integer;
begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='transactions' and column_name='reward_per_100') then
  select pg_get_expr(d.adbin,d.adrelid) into expression from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='public.transactions'::regclass and a.attname='earned' and a.attgenerated='s';
  if expression ~ '\*\s*5\M' then previous_rate=5;
  elsif expression ~ '\*\s*10\M' then previous_rate=10;
  else raise exception '未知的舊回饋公式，升級已取消，請先核對資料庫'; end if;
  execute format('alter table public.transactions add column reward_per_100 integer not null default %s check(reward_per_100 in (5,10))',previous_rate);
 end if;
 if exists(select 1 from public.transactions where earned<>((gross-redeemed)/100)*reward_per_100) then
  raise exception '舊交易回饋與規則不符，升級已取消';
 end if;
end $$;
alter table public.transactions alter column reward_per_100 set default 10;
-- DROP EXPRESSION retains stored earned values and existing dependencies/indexes.
alter table public.transactions alter column earned drop expression if exists;
create or replace function public.compute_reward_v373() returns trigger language plpgsql set search_path=public as $$
begin
 if tg_op='UPDATE' and new.reward_per_100 is distinct from old.reward_per_100 then
  raise exception '不可修改既有交易的回饋比例';
 end if;
 new.earned=((new.gross-new.redeemed)/100)*new.reward_per_100;
 return new;
end $$;
revoke all on function public.compute_reward_v373() from public,anon,authenticated;
drop trigger if exists transactions_reward_v373 on public.transactions;
create trigger transactions_reward_v373 before insert or update on public.transactions for each row execute function public.compute_reward_v373();

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
notify pgrst, 'reload schema';
commit;
