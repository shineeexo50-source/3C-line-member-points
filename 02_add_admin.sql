-- First create a confirmed user in Authentication > Users > Add user > Create new user.
-- Replace the EMAIL below. This script does NOT create a password.
do $$
declare target uuid;
begin
 select id into target from auth.users where lower(email)=lower('YOUR_ADMIN_EMAIL');
 if target is null then raise exception '請先在 Authentication > Users 建立此 Email 使用者'; end if;
 insert into public.admins(user_id) values(target) on conflict do nothing;
end $$;
-- Remove permission later (replace email, remove the leading --):
-- delete from public.admins where user_id in (select id from auth.users where email='YOUR_ADMIN_EMAIL');
