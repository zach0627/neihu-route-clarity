# 憑證安全管理

本專案的 GitHub 儲存庫與 Pages 網頁公開。公開內容限程式碼、文件及交通資料；TDX 憑證與 GitHub 登入憑證分開管理。

## 存放位置

| 項目 | 存放位置 | 使用範圍 |
| --- | --- | --- |
| 本機 TDX 憑證 | 被 Git 忽略的 `.env.local`，權限 `0600` | 本機 Node 下載腳本與安全掃描 |
| 雲端 TDX 憑證 | GitHub Actions Secrets 的 `TDX_CLIENT_ID`、`TDX_CLIENT_SECRET` | 歷史下載、即時更新與獨立安全掃描步驟 |
| GitHub CLI 登入 | macOS 鑰匙圈 | GitHub 管理操作 |
| Git 推送 | SSH 與本機既有金鑰 | `git@github.com:zach0627/neihu-route-clarity.git` |

前端不讀取憑證。不要把憑證放入 `PUBLIC_`／`VITE_` 變數、程式碼、網址或提交訊息。`.env.example` 只有空白欄位；`.env*`、`.credentials/`、研究快取與建置成品皆不提交。

## 推送與建置檢查

```sh
git config --local core.hooksPath .githooks
npm run security:check
```

本機 pre-push hook 掃描可見來源、建置輸出與所有 Git refs 的歷史 blob；比對已配置的實際 TDX 值，並檢查 Bearer token 及私有環境檔。歷史中已刪除的檔案仍會被檢查。沒有本機憑證時，掃描會明確說明無法進行實際值比對。新 clone 必須另行啟用 hook。

GitHub 已啟用 Secret scanning 與 Push protection。它們依 GitHub 支援的格式偵測，不能代替對 TDX 實際值的本機／Actions 掃描。

Actions 的套件安裝、測試、Vite 建置及第三方 actions 不接收 TDX 憑證環境變數。API 步驟才取得憑證；上傳 Pages 成品前，獨立步驟使用 Secrets 對成品與來源進行掃描。build 工作只有讀取程式碼的權限；deploy 工作才有 Pages 與 OIDC 寫入權限。Workflow 不使用 `pull_request_target`，也不從 fork PR 執行帶憑證的工作。

GitHub Pages 強制使用 HTTPS；`github-pages` 環境的部署分支限制為 `main`。Actions 預設 token 權限為唯讀，不能核准 Pull Request。

## 更新與撤銷

在 [TDX 平台](https://tdx.transportdata.tw/) 管理 API 憑證；更新後同步修改本機 `.env.local` 與 [此專案的 Actions Secrets](https://github.com/zach0627/neihu-route-clarity/settings/secrets/actions)，再執行安全掃描。不要把實際值貼到 Issue、PR、聊天或日誌。

若憑證曾經曝光，先在來源服務撤銷或重新產生，再更新上述兩處。僅刪除目前檔案不會移除 Git 歷史，也不會讓已曝光的憑證失效；歷史清理與強制推送應由儲存庫擁有者另行處理。
