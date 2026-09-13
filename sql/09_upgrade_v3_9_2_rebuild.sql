-- v3.9.2 穩定重建版：只補客訂/店員所需資料結構，不新增新的會員讀取 RPC。
-- 可重複執行；不會刪除會員、交易、點數、客訂資料。
begin;

create table if not exists public.staff_options(
  name text primary key check(length(trim(name)) between 1 and 60),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table if not exists public.custom_orders(
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  ordered_at timestamptz not null default now(),
  product_name text not null check(length(trim(product_name)) between 1 and 200),
  deposit_amount integer not null default 0 check(deposit_amount between 0 and 10000000),
  deposit_paid boolean not null default false,
  paid_in_full boolean not null default false,
  staff_name text not null default '' check(length(staff_name)<=60),
  notified boolean not null default false,
  notified_at timestamptz,
  notified_by uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.custom_orders add column if not exists note text not null default '';
create index if not exists custom_orders_member_ordered on public.custom_orders(member_id,ordered_at desc,id desc);
create index if not exists custom_orders_open on public.custom_orders(paid_in_full,notified,ordered_at desc);

alter table public.staff_options enable row level security;
alter table public.custom_orders enable row level security;
revoke all on public.staff_options from public,anon,authenticated;
revoke all on public.custom_orders from public,anon,authenticated;

notify pgrst, 'reload schema';
commit;
