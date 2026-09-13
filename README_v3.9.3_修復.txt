v3.9.3 會員資料 DB-RPC 修復

若 v3.9.2 已部署且會員頁仍顯示 DB-RPC：
1. 到 Supabase -> SQL Editor。
2. 執行 sql/10_repair_member_db_rpc.sql。
3. 成功後等待約 10 秒，重新整理管理端並重新開啟會員。

此 SQL 不會刪除會員或交易資料；它只補齊交易欄位、重建會員列表/詳細資料 RPC，並要求 PostgREST 重新載入 schema。
