-- Execute after 04 + 06. Uses temporary test records; ROLLBACK keeps business data unchanged.
begin;
do $$
declare a uuid; m uuid; lid text='VERIFY3_'||gen_random_uuid(); tid uuid=gen_random_uuid(); d jsonb; mon text=to_char(now() at time zone 'Asia/Taipei','YYYY-MM');
begin
 select user_id into a from public.admins limit 1;
 if a is null then raise exception '請先建立管理員'; end if;
 insert into public.members(line_id,display_name) values(lid,'V3 暫存驗收會員') returning id into m;
 perform public.admin_write_v2(a,'sale',jsonb_build_object('id',tid,'member_id',m,'gross',1000,'redeemed',0,'occurred_at',now(),'items',jsonb_build_array(jsonb_build_object('name','驗收商品','qty',1,'price',1000))));
 d=public.admin_operations_v3(a,'ledger',jsonb_build_object('member_id',m));
 if (d->'rows'->0->>'balance')::bigint<>50 then raise exception '流水帳驗收失敗'; end if;
 perform public.admin_write_v2(a,'void',jsonb_build_object('id',tid,'member_id',m,'reason','驗收回沖'));
 d=public.admin_operations_v3(a,'ledger',jsonb_build_object('member_id',m));
 if (d->'rows'->0->>'balance')::bigint<>0 then raise exception '回沖驗收失敗'; end if;
 d=public.admin_report_v3(a,mon,'same');
 if d->>'mode'<>'same' or jsonb_array_length(d->'days')<>extract(day from now() at time zone 'Asia/Taipei')::integer then raise exception '同期報表驗收失敗'; end if;
 d=public.line_page_v2(lid,'驗收');
 if d ? 'transactions' or (d->>'points')::bigint<>0 then raise exception '客戶隱私驗收失敗'; end if;
 if has_function_privilege('anon','public.admin_operations_v3(uuid,text,jsonb)','EXECUTE') or has_function_privilege('authenticated','public.admin_report_v3(uuid,text,text)','EXECUTE') then raise exception 'V3 權限驗收失敗'; end if;
 raise notice 'PASS：V3 點數流水、作廢回沖、同期報表及客戶隱私驗收通過。';
end $$;
rollback;
