v3.9.4 會員讀取穩定修復

這版針對「會員資料暫時無法讀取（DB-RPC）」做結構性修復：
- 會員列表與會員詳細資料不再依賴 admin_members_v2 / admin_detail_v2 RPC。
- API 先直接確認 admins 管理權限，再由伺服器端以 Supabase REST 讀取會員與交易。
- 消費新增、作廢、客訂、報表等需要資料一致性的寫入功能仍維持原 RPC。
- 不需要再執行新的 SQL；已執行 08、09、10 也不用回滾。
- 不刪除、搬移或重建會員資料。

部署：直接部署本版即可。若仍出錯，錯誤代碼會由 DB-RPC 改成更精確的 DB-REST / DB-KEY / DB-PERM / DB-SCHEMA，便於一次定位。
