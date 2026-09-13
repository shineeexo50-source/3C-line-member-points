v3.9.5 修復重點

1. 管理員登入成功後，不再呼叫 require_admin_v2 RPC 驗證管理權限。
2. Session 恢復／Refresh Token 更新後，也不再呼叫 require_admin_v2 RPC。
3. 改由伺服器端使用 Supabase Secret Key 直接查 admins 資料表驗證管理員。
4. 會員列表與會員詳情延續 v3.9.4 的 REST 直讀方式。
5. 因此「登入 → Session → 會員列表 → 會員詳情」讀取鏈已完全脫離會員 DB-RPC。
6. 不需要新增 SQL；不要重跑 08/09/10。
7. 部署後請用無痕視窗或強制重新整理，以排除舊版 JS 快取。

若部署後仍顯示 DB-RPC，表示瀏覽器或 Vercel 實際仍在執行舊版 api/app.js，因 v3.9.5 的登入與會員讀取鏈不會產生 DB-RPC。
