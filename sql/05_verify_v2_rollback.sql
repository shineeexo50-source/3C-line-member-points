-- Run AFTER 04_upgrade_v2.sql. All temporary records are rolled back.
begin;
do $$
declare a uuid; m uuid; lid text='VERIFY_'||gen_random_uuid(); tid uuid=gen_random_uuid(); d jsonb; payload jsonb; batch jsonb; count_before bigint;
begin
 select user_id into a from public.admins limit 1;
 if a is null then raise exception '請先建立管理員'; end if;
 insert into public.members(line_id,display_name) values(lid,'V2 暫存驗收會員') returning id into m;
 payload=jsonb_build_object('id',tid,'member_id',m,'gross',1000,'redeemed',0,'occurred_at',now(),'items',jsonb_build_array(jsonb_build_object('name','驗收商品','qty',2,'price',500)));
 perform public.admin_write_v2(a,'sale',payload);
 d=public.line_page_v2(lid,'驗收');
 if d ? 'transactions' or (d->>'points')::int<>50 or (d->'point_days'->0->>'earned')::int<>50 then raise exception '客戶顯示或權限範圍錯誤'; end if;
 d=public.admin_write_v2(a,'sale',payload);
 if not (d->>'duplicate')::boolean then raise exception '重複加點'; end if;
 batch=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'member_id',m,'external_id','VERIFY_'||gen_random_uuid(),'gross',500,'redeemed',50,'occurred_at',now(),'items',jsonb_build_array(jsonb_build_object('name','驗收折抵','qty',1,'price',500))));
 select count(*) into count_before from public.transactions where member_id=m;
 d=public.admin_import_v2(a,batch,true);
 if (d->>'created')::int<>1 or (select count(*) from public.transactions where member_id=m)<>count_before then raise exception '匯入預覽寫入了資料'; end if;
 perform public.admin_import_v2(a,batch,false);
 d=public.line_page_v2(lid,'驗收');
 if (d->>'points')::int<>20 or (d->>'total')::int<>1450 then raise exception '匯入後金額或點數錯誤'; end if;
 if has_function_privilege('authenticated','public.line_page_v2(text,text,jsonb,boolean)','EXECUTE') or has_function_privilege('anon','public.admin_report_v2(uuid,text)','EXECUTE') then raise exception '資料庫權限錯誤'; end if;
 raise notice 'PASS：獲點日記、客戶權限、重複交易、匯入預覽回滾、正式匯入與點數計算通過。';
end $$;
rollback;
