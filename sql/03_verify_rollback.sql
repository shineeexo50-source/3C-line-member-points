-- Optional acceptance check AFTER adding an administrator. All test data rolls back.
begin;
do $$
declare a uuid; m uuid; t1 uuid=gen_random_uuid(); t2 uuid=gen_random_uuid(); d jsonb; blocked boolean=false;
begin
 select user_id into a from public.admins limit 1;
 if a is null then raise exception '請先完成管理員設定'; end if;
 insert into public.members(line_id,display_name) values('TEST_'||gen_random_uuid(),'驗收用暫存會員') returning id into m;
 d=public.admin_action(a,'sale',jsonb_build_object('member_id',m,'id',t1,'gross',1000,'redeemed',0,'occurred_at',now()));
 if (d->>'points')::int<>50 or (d->>'total')::int<>1000 then raise exception '首次回饋計算錯誤'; end if;
 d=public.admin_action(a,'sale',jsonb_build_object('member_id',m,'id',t1,'gross',1000,'redeemed',0,'occurred_at',now()));
 if (d->>'points')::int<>50 then raise exception '重複入帳'; end if;
 d=public.admin_action(a,'sale',jsonb_build_object('member_id',m,'id',t2,'gross',500,'redeemed',50,'occurred_at',now()));
 if (d->>'points')::int<>20 or (d->>'total')::int<>1450 then raise exception '折抵後計算錯誤'; end if;
 begin
  perform public.admin_action(a,'void',jsonb_build_object('member_id',m,'id',t1,'reason','測試'));
 exception when others then blocked=true; end;
 if not blocked then raise exception '錯誤：允許負點數'; end if;
 d=public.admin_action(a,'void',jsonb_build_object('member_id',m,'id',t2,'reason','測試'));
 if (d->>'points')::int<>50 then raise exception '作廢折抵回沖錯誤'; end if;
 d=public.admin_action(a,'void',jsonb_build_object('member_id',m,'id',t1,'reason','測試'));
 if (d->>'points')::int<>0 or (d->>'total')::int<>0 then raise exception '作廢後餘額錯誤'; end if;
 if has_table_privilege('anon','public.members','SELECT') or has_table_privilege('authenticated','public.transactions','INSERT') or has_function_privilege('authenticated','public.admin_action(uuid,text,jsonb)','EXECUTE') then raise exception '資料權限錯誤'; end if;
 raise notice 'PASS：回饋、折抵、重複送出、負點數防護、作廢回沖及權限設定通過。';
end $$;
rollback;
