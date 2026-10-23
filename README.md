# 內湖園區搞清楚要走的路

React 車流觀測專案：分析內湖區「往內湖科技園區路段」在週一至週五 07:00–09:30 的 TDX 逐分鐘車流與車速，產生**車流量 Top 10** 與**塞車 Top 10**。包含「車流觀測」與「資料來源與計算」兩個頁面。

**往園區路段**由官方資料判定：臺北市商業處公布的園區門牌範圍，經 TDX 地址定位取得官方座標後圍出園區；再以 TDX 官方路段編碼的起點、終點，判斷每個偵測器所在路段是「入園」「園區內」「出園」或「園區外」，只排名前兩類。**塞車**以每分鐘車速套用臺北市在 TDX 發布的壅塞水準門檻（A–F 級），E、F 級分鐘比例由高至低排名，並與臺北市官方發布路段的逐分鐘壅塞等級交叉比對。完整說明見 [方向範圍說明](docs/directional-scope.md) 與 [塞車計算方式](docs/congestion-method.md)。

**彈性上班建議**（第三個頁面）：以範本公司（目前為仁寶，官方住址取自臺灣證券交易所 OpenAPI）為中心分東南西北四個方向，取每個方向朝公司前進、最塞且有臺北市官方路段可驗證的路段為基準，找出最後一個「過半時間在塞車」的 15 分鐘時段，其結束時間即建議的最晚彈性上班時間；每個方向都列出為什麼要增加與增加算式（例如「增加 45 分鐘 = 塞車解除 09:15 − 標準上班 08:30」），並說明每 15 分鐘更新時要呼叫的 API 與計算。見 [彈性上班建議的計算方式](docs/flex-hours-method.md)。

**國道**：本版不納入。國道主線以過境車為主；匝道偵測器在官方資料中對應的是國道主線 LinkID，無法用官方幾何確認是否通往園區；下匝道後仍須經市區道路，而那些路段已在判定中。理由也寫在網站「資料來源與計算」頁。

**目前主排名使用「有效分鐘平均車流率」：通過品質檢查的實測累計車次 ÷ 有效分鐘，單位為輛／分鐘。** 依使用者確認，以目前取得的有效資料產生前十名；不要求每一天都完整 150 分鐘，不插補、不乘上 150 推估完整早尖峰車次。每名同時呈現實測累計、有效分鐘與完整度。各方向採到的分鐘並不完全相同，因此結果代表已觀測部分的平均，無法保證是完整月份總車流的前十名。完整口徑與數字範例見 [有效分鐘排名說明](docs/observed-ranking-method.md)。

## 五個頁面

- **總覽（Dashboard）**：重點指標、時段熱度圖（哪條路幾點最塞）、園區每 15 分鐘塞車比例、壅塞地圖、每日趨勢（標示國定假日）、星期一到五比較（可切換排除假日）、範本公司彈性上班摘要、塞車前十名；GitHub Pages 版另有即時狀態。
- **車流觀測**：園區範圍圖、車流量 Top 10、塞車 Top 10、資料檢查。
- **彈性上班建議**：範本公司四個方向的建議、為什麼要增加與增加算式、每 15 分鐘更新的 API 與規則。
- **資料來源與計算**：所有 API、範圍判定、車流量與塞車算法、彈性上班算法、為什麼不納入國道、全部資料來源。

## 兩種版本

| | 離線示範版 | GitHub Pages 版 |
|---|---|---|
| 指令 | `npm run build` → `dist/index.html` | `npm run build:pages` → `dist-pages/` |
| 開啟方式 | 雙擊單一 HTML，不需網路、伺服器或憑證 | 部署到 GitHub Pages，以網址開啟 |
| 資料 | build 當時的歷史快照 | 由 GitHub Actions 排程更新（見下） |
| 即時狀態 | 不呼叫任何 API，頁面標示「離線示範版」 | 讀取同網站的 `live.json`，每 5 分鐘重新讀取 |

### GitHub Pages 版的排程（`.github/workflows/pages.yml`）

1. 在 GitHub 專案 **Settings → Secrets and variables → Actions** 新增 `TDX_CLIENT_ID`、`TDX_CLIENT_SECRET`（憑證只存在 GitHub Secrets，不會進入網頁或 Git）。**Settings → Pages** 的 Source 選 **GitHub Actions**。
2. 推送到 `main`：以已提交的快照建置並部署。沒有設定 Secrets 時，所有排程也只部署已提交的快照。
3. 平日 10:00（臺北）：下載前一天的歷史資料（只保留早尖峰與設備檔，存在 Actions 快取），重算最近 30 天快照後部署。第一次執行沒有快取，需下載約 22 個工作日，約 1 小時。
4. 平日 07:00–09:15（臺北）每 15 分鐘：`scripts/live-update.mjs` 在 15 分鐘內每分鐘呼叫一次 TDX 即時 API，計算近 15 分鐘的塞車狀態與今日彈性上班（規則同「彈性上班建議」頁），產生 `live.json` 後部署。GitHub 排程可能延遲數分鐘。
5. 也可在 Actions 頁手動執行（mode：snapshot / daily / live）。

本機測試即時更新：`npm run data:live -- --minutes 2`（會寫入 `data/live.json`，已被 Git 忽略），再 `npm run build:pages`。

## 直接打開成品

執行 `npm run build` 後，**雙擊 `dist/index.html` 就能開啟**。JavaScript、CSS、政府資料快照都封裝在同一個檔案；可把這個 HTML 單獨複製到別的資料夾，無須伺服器或網路。以 Chrome、Edge、Safari 等現代瀏覽器開啟。

這是 build 當時的資料快照。開啟 HTML 不會重新下載政府資料；畫面會顯示實際日期、下載完整度、每個方向的有效分鐘與範圍假設。可匯出分析 JSON 與有效分鐘排名 CSV（Excel 可開啟）。更新快照後需要重新 build，舊的 HTML 不會自動出現新的排名。

把整個 `dist` 資料夾傳給別人，對方以現代瀏覽器雙擊 `index.html` 即可，不必安裝 Node.js、不必啟動伺服器，也不需要 API 憑證。本次另提供 `artifacts/內湖園區搞清楚要走的路-dist.zip`，裡面只有 `dist/index.html`；解壓縮後再開啟。已實測解壓到另一個包含中文字與空格的資料夾，斷網開啟仍顯示十名與說明頁。若日後重新 build，傳送新的 `dist`，舊分享 ZIP 不會自動更新。

## 本機開發

需要 Node.js 22.12 以上（本專案已用 Node 24 驗證）。

```sh
npm install
npm run dev
```

開啟終端機顯示的本機網址。正式打包：

```sh
npm run build
```

build 會先編譯 React，再轉成可直接開啟的單檔 HTML，最後檢查 dist 與 Git 可見的來源檔案是否含本機憑證。

## 憑證只放這台電腦

本機的 `.env.local` 已設為檔案權限 `0600`，內容是 `TDX_CLIENT_ID` 與 `TDX_CLIENT_SECRET`。`.gitignore` 排除 `.env`、`.env.*`、`.credentials/`；只有不含值的 `.env.example` 可提交。原始大型研究快取、node_modules、dist 也預設不提交。

換到新電腦時：

```sh
cp .env.example .env.local
chmod 600 .env.local
```

在本機編輯 `.env.local` 填入自己的值。**不要使用 `VITE_` 或 `PUBLIC_` 作為憑證變數前綴。** 只有 Node 下載腳本需要憑證；React 不讀取憑證，也沒有 Token／Secret 輸入欄位。`dist` 只包含公開交通資料、介面與計算邏輯，不包含下載腳本或環境檔。

```sh
npm run security:check
```

若有 `.env.local`，會用其中的實際值掃描；若未設定，會明確說明只完成 Token 格式與 Git 忽略規則檢查。這項檢查也會拒絕被強制加入 Git 的環境檔。此專案已建立本機 Git，沒有推送遠端。

## 更新資料

預設抓臺北時間「昨天往前 30 個日曆日」內的週一至週五，兩個腳本使用同一組固定起訖日；未另外扣除國定假日。

```sh
npm run data:update
npm run build
```

指定日期範圍：

```sh
npm run data:update -- --start 2026-09-23 --end 2026-10-22
npm run build
```

單日驗證：

```sh
npm run data:update -- --date 2026-10-22
```

官方參考資料（園區門牌座標、路段幾何、壅塞門檻、發布路段對照）不常變動，需要時另外更新；約 100 個請求、每 13 秒一個：

```sh
npm run data:reference
```

官方發布路段路況歷史資料（塞車分級的交叉比對）。`npm run data:update` 已包含這一步，也可單獨執行：

```sh
npm run data:sections -- --start 2026-09-23 --end 2026-10-22
```

若只想用已下載資料重新計算：

```sh
npm run data:aggregate -- --start 2026-09-23 --end 2026-10-22
npm run build
```

每次請求間隔至少 13 秒，最多兩個下載工作並行；大份歷史資料需要時間。完整快取以 SHA-256 驗證後重用。成功、失敗、待補日期均保留；遇服務權限／額度或持續頻率限制會保留已下載部分，畫面顯示涵蓋不完整，不以缺測補零。

## API 與計算

同日設備資料：

`https://tdx.transportdata.tw/api/historical/v2/Historical/Road/Traffic/VD/City/Taipei`

同日車流資料：

`https://tdx.transportdata.tw/api/historical/v2/Historical/Road/Traffic/Live/VD/City/Taipei`

官方參考資料（`scripts/reference.mjs`）：

- 路段編碼：`POST https://tdx.transportdata.tw/api/basic/v2/Road/Link/LinkID`、`POST .../Road/Link/Shape/Geometry/GeoJson`
- 地址定位：`https://tdx.transportdata.tw/api/advanced/V3/Map/GeoCode/Coordinate/Address/{門牌}`
- 臺北市壅塞水準、發布路段、發布路段即時路況：`https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/{CongestionLevel|Section|Live}/City/Taipei`

官方發布路段路況歷史資料（`scripts/download-sections.mjs`）：

`https://tdx.transportdata.tw/api/historical/v2/Historical/Road/Traffic/Live/City/Taipei`

使用 `Dates`、`$format=JSONL`、足量的 `$top` 取得原始資料，保存來源網址、下載時間與檔案雜湊；若回傳筆數碰到上限，拒絕把截斷資料當完整資料。以同日靜態 `TownName=內湖區` 決定行政範圍。

1. 將 `DataCollectTime` 轉成臺北時間，取 `07:00 <= 時標 < 09:30`，共 150 個分鐘標記。
2. 每個方向的每分鐘加總所有車道、車種的原始 `Volume`。
3. 只接受設備正常、車道／車種不重複、車道數吻合、非負整數流量、全部旗標為 `diag0` 的紀錄；偵測車道少於道路實際車道時也不視為全路段完整量測。
4. 重複相同分鐘只計一次；同分鐘出現互相衝突的量測，該分鐘不採用。
5. 同一 LinkID 只選一支事先指定的代表測點，不把沿路多支測點相加。候選與代表測點的選擇不依流量大小決定。
6. 對每個代表方向，將所選日期中所有有效分鐘的實測車次加總，再除以該方向有效分鐘總數。以「輛／有效分鐘」由高至低排名，最多十名；至少須有一個有效分鐘才參與，沒有為湊名次設定完整度門檻。
7. 這是以分鐘數加權的整期觀測平均，不是把每一天的平均再等權平均。各方向實際有效的日期、分鐘可能不同，需同時查看有效分鐘、完整度與逐日品質；不能把平均值乘上 150 當成實測完整早尖峰車次。
8. 保留「每個所選日皆完整 150 分鐘」的嚴格檢查作為診斷。它與目前主排名是不同指標；嚴格合格數為零不會阻止有效分鐘排名顯示。

品質旗標採保守篩檢，未通過不等於已證明數字錯誤。資料頁會公開排除原因。`DataCollectTime` 究竟代表統計區間起點或終點仍待官方明確確認，因此頁面標明時間邊界可能差一分鐘。

## 往園區範圍

`config/park-boundary.json` 保存臺北市商業處的園區門牌範圍原文、機器可讀的範圍與定位查詢點；`scripts/aggregate.mjs` 依 `data/reference.json` 的官方門牌座標與官方路段起訖點判定範圍。`config/directions.json` 只提供同 LinkID 多支偵測器的代表優先序與人工例外（目前沒有例外）；v1 人工初選的理由保留供對照。沒有車輛目的地追蹤，無法宣稱每台車確定進入園區。更多依據在 [方向範圍說明](docs/directional-scope.md)。

## 資料與程式位置

- `src/`：React 介面；不連線 TDX。
- `lib/ranking.mjs`：前後端共用的純計算規則（車流量、車速分級、塞車排名、官方比對）。
- `lib/park.mjs`：門牌範圍比對、園區內道路區段與路段位置分類。
- `lib/flex.mjs`：四個方向的候選路段、15 分鐘塞車時段與彈性上班建議、即時更新規則。
- `config/companies.json`：範本公司（官方住址與來源）與預設標準上班時間。
- `scripts/reference.mjs`、`scripts/download-sections.mjs`：官方參考資料與官方發布路段路況下載。
- `data/reference.json`：官方參考資料中分析需要的欄位與來源雜湊，可提交 Git。
- `scripts/download.mjs`：本機驗證、下載、限流、壓縮快取與來源紀錄。
- `scripts/aggregate.mjs`：驗證完整快取、篩選與彙總。
- `data/dashboard.json`：build 使用的公開資料快照，可提交 Git。
- `research/`：本機原始回應、每日早上資料、下載紀錄；不提交 Git。
- `dist/index.html`：可雙擊、可單獨分享的成品；每次 build 重建。

## 驗證

```sh
npm test
npm run build
npm run test:offline
```

離線瀏覽器檢查會把 HTML 單獨複製到暫存資料夾，在無網路的 Chrome 中透過 `file://` 開啟，測試頁面、日期篩選、明細、JSON 匯出與手機版面；檢查沒有遠端資源請求或瀏覽器錯誤。預設使用 macOS 已安裝的 Google Chrome。

## 隨附快照的實際結果（2026-10-23）

已嘗試 2026-09-23 至 2026-10-22 的 22 個週一至週五日期，取得其中 21 個。2026-09-24 的完整回應未含可用的當日內湖早上紀錄，小量複查前幾筆仍是前一日時間標記，已明確排除；不會把前一天數字移作當天資料。

v2 依官方資料重新判定範圍：84 個偵測方向中，入園 5、園區內 26 個列入排名（30 個代表方向）；出園 7、園區外／邊界 26、市區快速道路 20 個不列入。v1 的第一名民權東路六段西向 VQBUL20，官方路段起點在園區內道路上（1 公尺）、終點離園區內道路 1,160 公尺（往民權大橋方向），v2 判為出園路段；舊宗路二段西北向 VRPSV70 的終點經官方路段確認接到堤頂大道側，也判為出園。

**車流量 Top 3**：民權東路六段東向 VQBUL20（95,015 ÷ 2,142 = 44.36 輛／分鐘）、內湖路一段東南向 VTNR640（63,510 ÷ 2,167 = 29.31 輛／分鐘）、瑞光路東南向 VS6TI00（38,775 ÷ 1,958 = 19.80 輛／分鐘）。

**塞車 Top 3**：陽光街東向 VQZTP20（E、F 級 2,112 ÷ 2,147 = 98.4%，平均 16.5 km/h）、瑞湖街北向 VRVTS00（E、F 級 2,211 ÷ 2,620 = 84.4%，平均 19.8 km/h）、洲子街東南向 VSRT620（E、F 級 1,859 ÷ 2,444 = 76.1%，平均 22.1 km/h）。這三條都是沒有臺北市發布路段的園區巷道，只能用預設門檻、無法與官方比對，頁面上逐列標示。

**與官方路段比對**：21 日、122,324 分鐘，等級完全相同 79.3%、相差一級內 97.7%，平均速度差 1.9 km/h（只用當分鐘車速時為 53.5%、5.9 km/h）。

數字都來自通過品質檢查的原始計數與車速，沒有加入示範或補估值。期間內 09/25（中秋節）、09/28（教師節）、10/09（國慶日補假）依人事行政總處 115 年辦公日曆表為放假日，依使用者決定，最小版本不排除。

原本「所有已取得日期都完整 150 分鐘」的嚴格規則仍有 0 個合格方向，因此舊版 `dist/index.html` 沒有名次；這是當時採用的指標與來源缺口造成，不是 HTML 無法顯示排名。主排名已改用使用者確認的有效分鐘口徑，重新計算快照及 build 後，成品會顯示實測平均排名。舊口徑的資料診斷見 [排名診斷](docs/ranking-diagnostics.md)。

完整度需要區分分母：已取得的 21 日共有 3,150 個預期分鐘；原要求的 22 日共有 3,300 個，還包含整日缺失的 09/24。例如 VQKWL61 的 3,029 個有效分鐘占已取得日期 96.16%，占原要求期間則為 91.79%。兩者不能混稱為同一個「整月完整度」。有效分鐘平均本身的分母始終是實際有效分鐘數。

Codex 側欄仍可能顯示原本的 neihu-traffic；實際專案已搬至「內湖園區搞清楚要走的路」。舊路徑保留符號連結作相容捷徑，讓既有聊天能繼續存取同一份專案，沒有複製第二份資料或憑證。側欄顯示名稱因工具限制需手動更新。
