# LINE 會員點數系統 V3｜完整升級與操作手冊

**版本：3.0.0｜2026-09-10**

程式已完成升級、建置與本機驗證。這份 ZIP 不會自動更新你的線上系統；請依「既有系統升級」完成 SQL 與 GitHub 更新，再測試 LINE。

## 0. 先看這裡：你現有網站要怎麼升級

**已有網站：不要刪資料、不重建 Supabase、不重跑 01_setup.sql。**

1. 先以 Supabase 的資料庫備份保存現況，記下 GitHub 目前 Commit。V2 沒有網頁 JSON 備份，升級前請使用平台備份或第 12 節的 CLI 流程。
2. Supabase → SQL Editor → New query → 貼 `sql/04_upgrade_v2.sql` 全部 → Run。已執行過也可重跑。
3. 再開 New query → 貼 `sql/06_upgrade_v3.sql` 全部 → Run。
4. GitHub 更新 ZIP 解壓後 `line-member-points` 裡的完整檔案與資料夾。根目錄必須直接有 `package.json`、`api`、`public`、`scripts`；不要上傳 ZIP 本身。
5. Commit 後到 Vercel 查看該 Commit 的部署。保留原有環境變數。正式網域指向這筆成功部署後，重新開啟 `/admin.html`。
6. 管理端頁尾要顯示 **版本 3.0.0** 和更新時間；登入後按「檢查資料庫版本」，網站與資料庫都應顯示 3.0.0。
7. 執行 `sql/07_verify_v3_rollback.sql` 驗收。它使用暫存會員，結尾回滾，不留下測試交易；audit 序號跳號屬正常。
8. 管理端「備份與還原」下載第一份 JSON，確認下載成功並保存到私人位置。

正式 LINE 入口和 Production 網址沒有改變時，不必重建 LIFF。SQL 成功不代表網站已更新，必須完成 GitHub 上傳與 Vercel 部署。

**登入保持：** 使用 HTTPS、HttpOnly Cookie；同一瀏覽器重新整理後可恢復登入。更換瀏覽器、網域、清除 Cookie 或登入遭撤銷時，仍需重新登入。Safari 與 LINE 內建瀏覽器可能各自保存登入；未提交的表單不會自動保存。

## 0.1 V3 新增內容

| 功能 | 使用方式 |
|---|---|
| 版本識別 Version | 管理端頁尾顯示版本、建置時間、GitHub Commit（有提供時），可檢查資料庫版本 |
| 同期比較 Comparison | 本月 1 日至今日，對比上月 1 日至同日；上月較短時截至上月底。可改完整月份 |
| 商品排行 Products | 依商品名稱合併，顯示數量前 20 名及折抵前金額 |
| 新客／回訪 Retention | 依系統最早有效交易區分首次消費與曾消費客人 |
| 點數對帳 Reconciliation | 有效交易餘額對比操作紀錄淨額，顯示差異人數、負餘額及全店未使用點數 |
| 點數流水 Ledger | 管理端查看入帳順序、贈點、折抵、作廢回沖與紀錄餘額 |
| 操作紀錄 Audit | 查看管理員、時間、會員及修改前後內容，逐頁載入 |
| 備份 Backup | 管理端下載一致的業務 JSON 快照，含校驗碼與點數合計 |
| 還原 Restore | 檔案驗證、產生演練 SQL 與正式還原 SQL；只接受空業務資料表 |
| 手機管理 Mobile | 直式交易卡片、較大的按鈕，選取會員後優先顯示新增消費 |
| 載入改善 Loading | 搜尋延遲 350ms 避免連續請求；公開設定共用一次讀取；功能模組按需載入；更新時自動更換資源版本碼 |

## 1. 這次完成的功能

| 項目 | 保留功能 |
|---|---|
| 客戶會員卡 | 可愛粉紅／紫色圓角卡片、會員編號、可用點數、累計實付、累計消費次數 |
| 客戶獲點日記 | 僅顯示「日期＋當日獲得點數」，同日合併，先載入最近 20 個有獲點的日期 |
| 交易隱私 | 購買項目、單筆金額、折抵明細、完整交易紀錄與店內備註只供管理端查看；客戶 API 不回傳這些資料 |
| 購買項目 | 管理端記錄品名、數量、單價，自動加總；每筆最多 50 個項目 |
| 舊交易補登 | 管理端可補充／更正品項，合計必須與原金額一致，保留修改紀錄 |
| 月度分析 | 本月實付、發出回饋、實際折抵、消費次數、人數與平均每筆實付 |
| 折線圖 | 切換每日實付、發出回饋、實際折抵或消費次數；可展開數字表 |
| 圓餅圖 | 依本月消費 1 次、2 次、3 次以上，分析各組會員人數比例 |
| 客戶比較 | 本月／上月金額、金額差額、消費次數、次數差額；可依金額或次數排序、分頁 |
| CSV 匯出 | 完整月份交易報表、客戶月度比較報表，Excel／Google Sheets 可開啟 |
| CSV 匯入 | 範本下載、品項合併、先檢查不入帳、確認後正式匯入、重複訂單檢查 |
| 速度優化 | 公開設定改為靜態檔、LINE 只初始化一次、管理頁不載入 LINE SDK、查詢合併與索引、交易分頁 |

**沒有改變的點數規則：** 每筆實付每滿 100 元回饋 10 點；1 點折 1 元。原金額－折抵＝實付；不足部分不跨筆累積。點數沒有到期日。

例：第一筆 1,000 元送 100 點；第二筆原金額 500 元、折抵 100 點，實付 400 元再送 40 點。累計實付 1,400 元、可用餘額 40 點。

## 2. 既有系統升級（你已經有 Supabase／GitHub／Vercel 時）

**請沿用現有專案、會員資料、管理員與 LINE LIFF。不用全部重建。** 這個升級適用本對話原先交付的 v1 資料表（admins、members、transactions、audit）。若你另行修改過表名或資料結構，應先核對差異。

1. 先保存目前 GitHub 的 Commit，並備份 Supabase 資料庫。CSV 是業務報表，不等於完整可還原資料庫備份。
2. 選擇暫時沒有店員入帳的時段更新，避免新舊管理頁同時操作。
3. Supabase → SQL Editor → New query。
4. 打開 `sql/04_upgrade_v2.sql`，**複製全部內容**貼上 → Run。
5. 接著以 New query 執行 `sql/06_upgrade_v3.sql`，成功後才更新網站。此 SQL 新增 items／external_id、索引與 v2 函式，不刪會員、交易或點數。可重跑；大量資料建立索引可能需要時間。
6. **舊系統不要重跑 `01_setup.sql`，也不要刪除舊表。**
7. GitHub 打開現有 repository，把解壓後的程式檔案更新到原本位置 → Commit changes。Root 應直接看到 package.json、api、public、scripts。
8. 必須新增／更新的檔案見下一節。不要只換 public/index.html 或上傳 ZIP 本身。
9. Vercel 會由 GitHub 自動部署；若未啟動，先確認部署 Source 為剛上傳的最新 Commit，再重新部署該版本。保留原來的所有環境變數，等待 Ready。
10. 既有 LIFF 的 Endpoint URL 若仍是相同 Production 網址，不需要更改。
11. 關閉舊管理頁與 LINE 會員頁，重新開啟。管理端應看到「月度分析／會員與交易／試算表匯入／點數與紀錄／備份與還原」。
12. 可將 `sql/05_verify_v2_rollback.sql` 全部貼到 Supabase SQL Editor 執行。此驗收使用暫存會員，結尾 ROLLBACK，不留下測試交易。
13. 依第 10 節完成真實手機驗收，再恢復正常入帳。

若 SQL 未成功，先處理錯誤，不要繼續上線 v2。新版 API 缺少函式時會提示依序執行 04_upgrade_v2.sql 和 06_upgrade_v3.sql。

## 3. 必要網站檔案（只有手機也可逐檔貼上）

手冊底部有每個檔案的全部程式碼及複製按鈕。iPhone 可在 Safari 使用「要求桌面網站」操作 GitHub。

| 路徑 | 功能 |
|---|---|
| package.json | 建置指令、Node 22.x |
| package-lock.json | 專案版本鎖定，沒有外部 npm 依賴 |
| vercel.json | 建置／輸出設定與安全標頭 |
| scripts/build.mjs | 將 public 複製到 dist，生成安全的公開設定 |
| api/app.js | LINE／管理員驗證、受保護的資料 API |
| public/index.html | 客戶端入口 |
| public/app.js | 客戶會員卡與每日獲點 |
| public/admin.html | 管理端入口 |
| public/admin.js | 管理、交易、報表與匯入 |
| public/core.js | 共用介面、資料請求與下載功能 |
| public/charts.js | 管理端折線圖與圓餅圖 |
| public/csv.js | CSV 格式處理與檢查 |
| public/operations.js | 對帳、流水、操作紀錄與備份介面 |
| public/backup.js | 校驗碼、備份驗證及還原 SQL 產生器 |
| scripts/backup-tool.mjs | 網站無法使用時的離線備份驗證／SQL 產生工具 |
| public/style.css | 客戶可愛樣式與管理端版面 |
| public/privacy.html | 隱私權與使用說明 |

手機逐檔方式：GitHub → Add file → Create new file → 檔名輸入完整路徑（例如 `public/admin.js`）→ 貼上對應完整程式碼 → Commit changes。若已有檔案，打開檔案按 Edit，整份替換。

**`api/app.js` 與 `public/app.js` 是兩個不同檔案。`scripts/build.mjs` 不可漏掉，否則會出現 Cannot find module。**

## 4. 從零建立時的完整順序

已有系統請跳過本節，只按第 2 節升級。

### A. Supabase
1. 登入 https://supabase.com/dashboard → New project，建立新的專案並保存資料庫密碼。
2. SQL Editor → New query → 貼上 `sql/01_setup.sql` 全部 → Run。
3. 再開 New query → 貼上 `sql/04_upgrade_v2.sql` 全部 → Run；接著再開 New query 執行 `sql/06_upgrade_v3.sql`。
4. Authentication → Users → Add user → Create new user，填管理員 Email 與自行設定的密碼；有 Auto Confirm 時勾選。
5. 打開 `sql/02_add_admin.sql`，把 `YOUR_ADMIN_EMAIL` 換成剛建立的 Email，再於 SQL Editor 執行。
6. Project Settings／API Keys／Connect 取得 Project URL、Publishable（或 anon）key、Secret（或 service_role）key。

### B. LINE Developers
1. 登入 https://developers.line.biz/console/，選店家 Provider。
2. 建立或選取 **LINE Login channel**，App type 為 Web app。
3. 保存 Basic settings 中純數字的 Channel ID；不要用 Channel name 或 Messaging API 的 Channel ID。
4. 先完成下一步 Vercel 部署，取得固定正式網址。

### C. GitHub 與 Vercel
1. https://github.com → New repository，建 Private repository。
2. 解壓 ZIP，把 `line-member-points` 裡面的檔案與子資料夾上傳。不要把資料夾又包在另一層，不要只上傳 ZIP。
3. https://vercel.com/dashboard → Add New → Project → Import 該 GitHub repository。
4. Framework：**Other**；Root：`./`；Build Command：`npm run build`；Output：`dist`。Install Command 保持預設。
5. 添加環境變數如下，再 Deploy。LIFF_ID 可等取得後再新增並重新部署。

| Vercel 環境變數 | 要填的值 |
|---|---|
| SUPABASE_URL | Project URL，例如 https://abcdef.supabase.co，沒有 /rest/v1 |
| SUPABASE_SECRET_KEY | Secret key 或 Legacy service_role key，僅放伺服器 |
| SUPABASE_PUBLISHABLE_KEY | Publishable key 或 Legacy anon key |
| LINE_CHANNEL_ID | LIFF 所屬的 LINE Login Channel ID，純數字 |
| LIFF_ID | 完整 LIFF ID，例如 1234567890-AbCdEfGh，不是網址 |
| STORE_NAME | 店名，例如鼓山3C手機配件 |
| BUSINESS_NAME | 實際法定名稱，例如輝赫商行 |
| SUPPORT_CONTACT | 實際客服電話或 Email |

6. 部署 Ready 後複製固定 Production 網址，例如 `https://your-store.vercel.app`。所有示範 your-store 都要換成實際值。
7. 確認正式網址不要求客戶登入 Vercel（Settings → Deployment Protection）；會員身分由 LINE 驗證。
8. 正式營業請採允許商用的 Vercel 方案；Hobby 限個人非商業用途。服務費用依各平台方案，不包含在 ZIP 中。

### D. LIFF 與官方帳號入口
1. 回同一個 LINE Login channel → LIFF → Add。
2. 名稱填「店家會員點數」、Size：Full、Endpoint URL：`https://your-store.vercel.app/`、Scopes：勾 **openid、profile**。
3. 儲存取得 LIFF ID。回 Vercel 添加 LIFF_ID → Save → Redeploy，等待 Ready。每次修改設定值都需重新部署，因為公開設定在建置時產生。
4. 若 LINE Web app 設定要求 Callback URL，填正式根網址；此版不是 Supabase LINE OAuth provider，不填 Supabase auth callback。
5. Privacy／Terms URL 可填 `https://your-store.vercel.app/privacy.html`，先確認內容符合店家實際做法。
6. 將 LINE Login channel 從 Developing 改成 Published，讓一般客戶可登入。
7. LINE Official Account Manager（https://manager.line.biz/）→ 圖文選單 → 設定一格「會員點數」→ 動作選連結 → 貼 **`https://liff.line.me/你的LIFF_ID`** → 儲存並啟用。
8. 店員使用 `https://your-store.vercel.app/admin.html`，以 Supabase 建立的管理員 Email／密碼登入。

不需要 Messaging API access token、Webhook 或額外推播程式。若沿用舊 LIFF，確認 LINE_CHANNEL_ID 是它所屬的 channel。

## 5. 客戶端顯示與隱私

客戶只能查看自己的會員卡。LINE token 在伺服器驗證，不能用另一人的會員編號取代身分。

| 客戶可以看到 | 客戶不能取得 |
|---|---|
| 姓名、會員編號 | 品名、數量、單價 |
| 累計實付消費與累計消費次數 | 單筆消費金額 |
| 可用點數 | 單筆折抵紀錄 |
| 每日獲點日期與合計點數 | 完整交易紀錄、交易 ID、店內備註 |

獲點日記例：2026 / 09 / 10 ＋100 點。同一天多筆交易的回饋合併。沒有回饋的日期不顯示；作廢回饋排除。這是「有效回饋按日期加總」，不是不可變更的點數流水帳。

獲點合計與餘額可能不同，因為餘額已扣除使用過的點數。客戶要核對購買內容時，可透過官方 LINE 詢問店員。

## 6. 管理端操作：購買項目與交易

### 新增消費
1. 「會員與交易」→ 搜尋姓名、電話或完整會員編號 → 查看／新增消費。
2. 新增消費填品名、數量、單價。按「＋ 新增購買項目」加入更多商品。
3. 系統自動加總原金額。輸入折抵點數，預覽實付與新增回饋。
4. 消費時間以台灣時間輸入；訂單編號可選填，建議對應店內單據。
5. 按確認新增消費，更新餘額並保存操作紀錄。

### 查看與補充品項
1. 會員頁下方「交易紀錄」每次顯示 20 筆，可載入較早交易，沒有只保留 500 筆的限制。
2. 點日期／品項摘要展開，可看品項小計、交易 ID、訂單編號、店內備註。
3. 「編輯項目」可補舊交易品名或更正描述；合計須等於原金額。**舊版未記錄的品名無法自動猜回來。**
4. 要改金額或折抵，作廢原交易再建立正確交易。作廢會回沖回饋與折抵，不能讓餘額變負。
5. 新增、補品項、改會員資料及作廢都有 audit 紀錄。

管理員登入使用 HttpOnly Cookie 維持，重新整理會恢復登入；伺服器驗證或更新失敗才要求重新登入。客戶端不提供管理員查詢或匯出功能。

## 7. 月度圖表：數字怎麼看

| 指標 | 定義 |
|---|---|
| 實付消費金額 | 有效交易的原金額－折抵金額之合計 |
| 發出回饋金額 | 有效交易 earned 點數合計，因 1 點＝1 元，以元顯示；不是銀行現金支出 |
| 實際折抵金額 | 有效交易 redeemed 點數合計 |
| 消費次數 | 有效交易筆數，同一天兩張單算 2 次，不是來店天數 |
| 消費會員數 | 有效交易中不同會員的人數 |
| 平均每筆實付 | 本月實付÷有效交易筆數；無交易時顯示 0 |
| 金額／次數差額 | 本月－上月，可正可負 |
| 百分比 | （本月－上月）÷上月；上月為 0 時顯示不計百分比 |

- 月份以 Asia/Taipei 計算，不受店員裝置時區影響。
- 預設同期模式：本月截至台灣今日，對比上月相同日期範圍（上月較短則截至月底）。歷史月份按整月比較；可切換完整月份模式。今天仍持續入帳，上月比較日則含整天；不是精確到當下時分的比較。
- 折線圖一次選一種指標，避免金額與次數共用同一尺度造成誤判。
- 圓餅圖分組是客戶人數：消費 1 次／2 次／3 次以上，不是商品占比。
- 比較表納入本月或上月有消費的會員，因此上月有買、本月尚未回訪的人也能看到。
- 已作廢交易排除，所以日後作廢舊交易會更新原交易月份的分析。這不是鎖定帳期的正式會計報表。
- 月報是即時查詢；匯出大量資料時建議暫停入帳／作廢，以免讀取過程中資料持續變動。

## 8. 試算表匯出與匯入

### 匯出到 Excel／Google Sheets
1. 「月度分析」選月份 → 更新報表。
2. 按「匯出本月交易 CSV」下載該月全部交易，包含作廢狀態與品項；不受畫面 20 筆分頁限制。
3. 或在客戶比較區按「匯出客戶比較 CSV」，保存本月／上月的差額表。
4. Excel 使用「資料 → 從文字／CSV」，編碼 UTF-8。會員編號、電話等欄位選文字，避免電話的 0 被自動移除。
5. Google Sheets：檔案 → 匯入 → 上傳 CSV。這是手動匯入，**尚無 Google Sheets 即時雙向同步**。
6. 匯出 CSV 對容易被解讀為試算表公式的文字加上單引號，以免客戶名稱或備註觸發公式。

### 將試算表消費匯入系統
1. 管理端「試算表匯入」→ 下載空白範本。
2. 每行一個品項，欄位順序如下，欄名不可更換：

| 訂單編號 | 會員編號 | 消費時間 | 購買項目 | 數量 | 單價 | 折抵點數 | 店內備註 |
|---|---|---|---|---|---|---|---|
| SHOP-20260910-001 | 貼客戶完整會員編號 | 2026-09-10 10:30 | 手機殼 | 1 | 300 | 0 | 門市消費 |
| SHOP-20260910-001 | 同一會員編號 | 2026-09-10 10:30 | 充電線 | 2 | 100 | 留白 | 留白 |

這兩行會合成原金額 500 元的一筆交易。上表是格式說明，不是可直接匯入的真實資料。

3. 同一訂單第一行填折抵與備註；後續行可留白，或填完全相同內容。折抵只計一次，不會每行重複扣。
4. 訂單編號需全店唯一，不要每月重用 001。相同訂單跨不同檔案仍會辨識重複。
5. 只接受已存在會員的完整 UUID，不用姓名／電話自動配對，也不匯入不存在的 LINE 身分。
6. 消費時間未標時區時視為台灣時間；不可填未來日期，支援 YYYY-MM-DD HH:mm 或 ISO +08:00／Z。
7. 另存 **CSV UTF-8**，不是直接上傳 XLSX。每次最多 200 筆訂單、2,000 行品項、1 MB。
8. 上傳 CSV → 看前 10 筆預覽 →「先檢查資料（不入帳）」。伺服器會模擬點數扣抵與寫入，再回滾。
9. 檢查通過後，按「確認正式匯入」。送出時再次檢查最新會員餘額。
10. 相同訂單編號且內容一致會略過；內容不同會拒絕。任何一筆失敗，整批新交易回滾。
11. 預覽不會保留交易或 audit 資料，但資料庫序號可能有跳號，屬正常現象。

**匯入限制：** 它是新增交易工具，不是資料庫備份還原工具。歷史補登以目前點數餘額檢查，不重建各歷史時點餘額；沒有單獨匯入期初點數的功能。分析用匯出報表與匯入範本欄位不同，不能原檔直接回灌。

若網路中斷，請用「同一份檔案、同一組訂單編號」重新檢查；不要改訂單編號重新匯入。已作廢訂單重傳不會被復活。

## 9. 速度改善與可再調整的設定

### 已在程式完成
- 以前客戶初始載入重複打 config API，現在由建置產生 `/config.json`，前端讀一次，沒有資料庫金鑰。
- LINE SDK 與設定平行載入；登入初始化只執行一次，按「更新點數」不重新初始化。
- 管理端使用自己的入口，不載入 LINE SDK；圖表僅在管理端需要時載入。
- 既有會員的 me 請求原本依序呼叫 LINE 驗證、會員查詢、會員資料 RPC；現在是 LINE 驗證＋一個合併 RPC（外部呼叫 3 次→2 次）。仍保留真正的 token 驗證。
- 客戶不下載完整交易明細，只讀摘要與 20 個每日獲點記錄。
- 管理端 20 筆交易分頁；大量紀錄不一次塞入畫面。報表由資料庫彙總，不把全店交易載回瀏覽器才算。
- 新增會員／日期／ID 分頁索引、月份有效交易索引。私有資料回應保持 no-store，避免共用快取洩漏個資。
- 沒有額外圖表套件、遠端字型、大圖片或正式環境 npm 依賴。

### 你在平台還能改善的部分

Vercel Functions 最好靠近 Supabase 資料庫，而不只看使用者在哪裡。官方指出函式與資料來源的距離會影響延遲。

1. 先查看 Supabase 專案實際 Region。
2. Vercel → Project Settings → Functions → Function Regions，選與資料庫同區或鄰近的區域。
3. 常見對照：Supabase 東京 → Vercel `hnd1`；新加坡 → `sin1`；美東 → `iad1`。以實際可用區域與方案為準。
4. Save 後重新部署。這個包沒有擅自固定 Region，因為未取得你現有資料庫位置。
5. **Build log 顯示的建置地點，不等於已確認的 Function 執行區域。** 不應只看到 iad1 的建置訊息就判定慢的原因。
6. 若 Supabase 是免費且已被暫停的專案，先恢復服務；正式營運可評估不因閒置暫停的付費方案。

官方參考：https://vercel.com/docs/functions/configuring-functions/region

**速度沒有先保證幾秒或快幾倍。** 目前沒有你的正式網址測量結果。建議同一支手機、同一網路，分別測第一次開啟與重開各 5 次，記錄「點 LIFF→會員卡可見」時間，再比較中位數。網路、LINE 登入同意、服務喚醒與資料庫位置都會影響時間。

## 10. 驗收與已完成測試

### 本機驗證已完成
- 24 項 Node API／CSV／登入測試（含新增 10 項 Cookie、更新與登出測試）：LINE 身分綁定、客戶欄位白名單、管理權限、跨站拒絕、缺少 migration 提示、CSV 引號／換行、會員混配、日期／數量、公式文字安全。
- V2 的 15 項 PostgreSQL-WASM（PGlite）整合測試：v1→v2 保留資料、重跑 migration、台灣月份邊界、報表合計、獲點日記、月差額、重複交易、品項金額、作廢、audit、匯入預覽回滾、整批失敗回滾、資料權限、分頁、可貼上驗收 SQL。
- V3 的 PostgreSQL 整合驗證：新增升級可重跑、同期期間、點數流水與回沖、對帳差異、非管理員拒絕、JSON 校驗、拒絕覆蓋現有資料、缺少 Auth 帳號拒絕、演練回滾及正式還原資料一致性。
- 生產建置與 JavaScript 語法檢查。

PGlite 是本機 PostgreSQL 測試環境，不代表已測過你的 Supabase 網路、PostgREST 部署、LINE 帳號與手機瀏覽器。沒有宣稱正式環境的實測速度，也未進行真實手機端到端測試。

### 正式上線請實際確認
1. A／B 兩個 LINE 帳號顯示不同會員卡。
2. A、B 看不到交易明細；A 當天獲點日記只顯示 A 的日期與點數。
3. 管理員為 A 新增手機殼 300＋兩條線各 100：原金額 500、實付 500、回饋 50。
4. 再新增原金額 200、折抵 50：實付 150、回饋 10。A 累計實付 650、餘額 10，同日獲點日記合計 60。
5. 管理端圖表／客戶比較與上述交易一致；B 不受影響。
6. 點開交易可看購買項目；舊交易顯示未填品項，可補充但不能改合計。
7. 作廢第二筆：累計實付回 500、餘額 50、同日有效獲點回 50。
8. CSV 先檢查不入帳；正式匯入一次，再上傳同檔，應略過重複訂單。
9. 匯出月份 CSV，用 Excel 檢查中文、電話、品名與金額；作廢交易有狀態標示。
10. 關閉重開 LINE，頁面仍有資料，沒有要求客戶登入 Vercel。

## 11. 常見錯誤

| 現象 | 處理 |
|---|---|
| Cannot find module scripts/build.mjs | GitHub 根目錄必須有 scripts 資料夾與 build.mjs，路徑不可少一層 |
| 缺少 SQL 函式 | 依序完整執行 04_upgrade_v2.sql、06_upgrade_v3.sql，不能只貼幾行 |
| 仍是舊畫面 | 開正式網址 /config.json，version 應為 3.0.0；若不是，核對 GitHub package.json 與 Vercel Source Commit。若是，關閉舊視窗再開管理端，核對頁尾版本 |
| config.json 缺少 LIFF_ID | Vercel 添加 LIFF_ID，Save 後 Redeploy |
| 管理員沒有權限 | Authentication 建 User 後還需把該 UUID 加入 admins；用 02_add_admin.sql |
| 自己可登入，客戶不能 | LINE Login channel 是否 Published，LIFF openid／profile 是否勾選 |
| 品項合計錯誤 | 原金額需等於數量×單價的合計；舊交易補項目不改金額 |
| CSV 欄位錯誤 | 先下載範本，保留完整欄名及順序；Excel 另存 CSV UTF-8 |
| CSV 同一訂單內容不同 | 檢查會員、時間、折抵、備註及既有訂單；勿隨意換單號重傳 |
| 作廢會使點數變負 | 先處理後續折抵交易，再作廢原本的發點交易 |
| 圖表回饋與餘額不同 | 回饋是當月發出的點數，餘額是全部歷史回饋減折抵，兩者定義不同 |

## 12. 備份、還原與點數核對

### A. 平日備份：手機可以操作
1. 登入管理端 →「備份與還原」→「下載備份 JSON」。
2. 到手機「檔案」或電腦下載資料夾，確認 `會員業務備份_日期.json` 存在。網站顯示下載不代表你已另存成功。
3. 每個營業日結束保存一份，並在大批匯入或升級前再保存。建議保留最近 30 份日備份及 12 份月備份；這是建議，由你實際執行，程式不會自動刪除或排程。
4. 備份保存到受保護的私人位置，另一份放不同裝置或私人雲端。不要上傳公開 GitHub、貼到群組或當一般 CSV 分享。
5. 這份快照包含 admins、members、transactions、audit；點數由交易重新計算。備份本身沒有程式設定的到期日。

網頁快照限制為序列化後約 3 MB；資料庫預檢也可能較早拒絕。超過時不會截斷、分批拼湊或假裝成功，請走完整資料庫備份。產生快照會短暫阻擋寫入，建議在休息時段操作。

### B. 檔案驗證與還原演練
1. 管理端「備份與還原」選取先前保存的 JSON。
2. 檔案只在瀏覽器內驗證，不上傳還原資料到 API。確認備份日期、會員筆數、交易筆數及點數合計。
3. 「下載還原演練 SQL」會產生結尾為 ROLLBACK 的完整 SQL。
4. **演練環境必須是空的業務資料表，且已執行 01、04、06。原管理員 Auth UUID 也必須存在。** 單純用同一 Email 建新帳號不代表 UUID 相同。
5. 若使用全新的 Supabase 專案，先按官方完整備份還原流程恢復 Auth；不能只靠業務 JSON 重建密碼與登入帳號。不要手動插入假 Auth UUID 或修改備份繞過檢查。
6. 在符合條件的測試環境 SQL Editor 執行演練，看到「還原核對通過」及正確筆數；結尾回滾，資料不保留。
7. 校驗碼只能偵測檔案是否變動，不是數位簽章。只使用自己保存且來源可信的備份。

### C. 正式還原
1. 還原與升級不同：**一般升級不需要執行還原 SQL。**
2. 若正式資料需要復原，先停止店員寫入、保存當前狀態，優先使用 Supabase 資料庫備份還原到測試／復原環境核對。
3. 業務 JSON 還原只用於已確認空表且保有原 Auth UUID 的目標環境；從管理端產生「正式還原.sql」。
4. 核對 SQL 目標專案後，以新查詢一次執行。程式會驗證空表、Auth 關聯、資料庫限制、筆數與點數合計；失敗則整批不提交。
5. 不要刪掉現有資料來通過空表檢查；這個工具不處理線上資料合併或覆蓋。
6. 成功後登入管理端，查點數對帳、抽查會員、測試 LINE 身分與一次交易，才恢復營業。
7. 業務 JSON 不含 Auth 密碼／工作階段、Storage 檔案、LINE Developers 設定、Vercel 金鑰或網域；這些要分開保存或還原。

### D. 網站打不開時：離線產生 SQL

在電腦安裝 Node.js 22，解壓完整包，在專案目錄執行。將 `你的備份.json` 換成真實備份檔案路徑。這些命令不連線、不寫資料庫，不需要金鑰；輸出檔若已存在會拒絕覆蓋。

```bash
node scripts/backup-tool.mjs verify "你的備份.json"
node scripts/backup-tool.mjs drill "你的備份.json" "還原演練.sql"
node scripts/backup-tool.mjs restore "你的備份.json" "正式還原.sql"
```

### E. 完整資料庫備份與大資料量

業務 JSON 是額外的可攜備份，不能取代完整災難復原。Supabase 的平台備份可用性依專案方案與備份類型而異，請在 Dashboard 的 Backups 確認實際備份日期與可還原選項。

電腦已安裝 Supabase CLI 和 Docker 時，依官方流程使用 Connect 的資料庫連線字串，分別匯出角色、結構和資料。以下字串必須替換；請在私人電腦操作，不要把密碼或輸出檔放進 GitHub：

```bash
supabase db dump --db-url "你的資料庫連線字串" -f roles.sql --role-only
supabase db dump --db-url "你的資料庫連線字串" -f schema.sql
supabase db dump --db-url "你的資料庫連線字串" -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
```

三次匯出時暫停業務寫入。完整還原需依原專案 Auth、擴充套件、加密及 Storage 狀況調整，不提供對未知正式專案直接覆寫的一鍵命令。請依官方步驟在新復原專案操作，先核對再切換正式環境。

官方完整步驟：https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
平台備份範圍：https://supabase.com/docs/guides/platform/backups

### F. 點數對帳與管理紀錄
1. 管理端「點數與紀錄」→「點數對帳」，查看全店未使用點數、差異人數及負餘額。
2. 可用點數＝全部有效交易贈點－全部有效交易折抵，不是本月報表相減。
3. 「點數流水」按實際管理操作順序顯示，補登舊消費時不會倒插到舊入帳順序。
4. 「紀錄餘額」依 audit 重建；若有人直接修改資料庫或舊資料缺少 audit，可能與交易餘額不同。對帳是淨額比較，不保證找出所有互相抵銷的漏記或每種資料損毀。
5. 差異不會自動修正；先核對原始交易與操作紀錄。金額錯誤仍採作廢重建，不開放無原因直接改餘額。
6. 操作紀錄列出管理員與前後內容；所有目前授權管理員都能查看、備份及匯入。本版尚未區分主管／店員角色。

## 13. 上線範圍與官方參考

已提供完整程式、SQL、驗收腳本與操作手冊。尚未直接登入你的 GitHub／Vercel／Supabase 帳號替你部署，也未在你的 LINE 或手機實測。沒有啟用自動排程備份、Google Sheets 即時同步、庫存或 POS 串接。

- LINE LIFF 設定：https://developers.line.biz/en/docs/liff/registering-liff-apps/
- LINE token 驗證：https://developers.line.biz/en/docs/line-login/verify-id-token/
- Supabase 查詢優化：https://supabase.com/docs/guides/database/query-optimization
- Supabase API keys：https://supabase.com/docs/guides/getting-started/api-keys
- Vercel Function 區域：https://vercel.com/docs/functions/configuring-functions/region
- Vercel Hobby 商用限制：https://vercel.com/docs/plans/hobby

程式保存在 GitHub，交易與會員保存在 Supabase。更新網頁不會自動備份資料庫，請另行維持適當的資料備份。
