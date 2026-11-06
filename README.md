# 行政區宅配大挑戰

公民科限時競賽遊戲。學生輸入學號登入，3 分鐘內判斷兩件包裹的縣市層級與鄉鎮市區層級，伺服器即時計分，保留每人最高分並顯示 Top 10 榮譽榜。教師後台可以查看成績並匯出 CSV。

- **校內競賽**：登入學號、伺服器計分、上榮譽榜。
- **限時衝刺／練習模式**：不用登入、不計入成績。
- 遊戲中都不跳視窗，答錯只閃一下正解；完整解答在結局的成績視窗裡查看。
- 架設在 Cloudflare 免費方案（Workers ＋ D1 資料庫）。

---

## 一、第一次部署（只需要做一次）

### 1. 建立 D1 資料庫

1. 登入 [Cloudflare](https://dash.cloudflare.com)。
2. 左側選單「Storage & databases」→「D1 SQL database」→「Create database」。
3. 名稱填 `delivery-game-db`，按「Create」。
4. 複製 **Database ID**，把 `wrangler.jsonc` 裡的 `REPLACE_WITH_D1_DATABASE_ID` 換成這串 ID，存檔並更新到 GitHub。

### 2. 從 GitHub 建立 Worker

1. 左側選單「Workers & Pages」→「Create application」→「Import a repository」。
2. 選擇 `7-11GAME` 這個 repository。
3. 專案名稱填 `delivery-game`（必須和 `wrangler.jsonc` 的 `name` 一樣）。
4. Build command 留空；Deploy command 保持 `npx wrangler deploy`。
5. 按「Deploy」，等它跑完。

### 3. 設定後台密碼

進入 Worker →「Settings」→「Variables and Secrets」→「Add」，Type 選 **Secret**，名稱填 `ADMIN_PASSWORD`，值填你的後台密碼（至少 8 個字元），按「Deploy」儲存。

### 4. 完成

- 學生遊戲：`https://delivery-game.你的名稱.workers.dev/`
- 教師後台：`https://delivery-game.你的名稱.workers.dev/admin`

到教師後台匯入學生名單就可以開始比賽。

學號 **LJ140000** 是共用的測試帳號：不必匯入名單，成績不上榮譽榜，也不計入後台統計。要更改請修改 `config.js` 的 `testAccounts`。

---

## 二、匯入學生名單

在教師後台 →「匯入名單」上傳 CSV（第一列是欄位名稱）：

| 學號 | 姓名 | 班級 | 座號 |
|---|---|---|---|
| LJ14001 | 王小明 | 801 | 1 |

- 必填：**學號、姓名、班級**；座號可省略。
- 學號已存在時會更新姓名與班級，成績不受影響。
- **名單含學生個資，請不要上傳到 GitHub**。`.gitignore` 已設定：放在 `private/` 資料夾、或檔名含「名單」的 CSV 都不會被 Git 上傳。

---

## 三、調整遊戲規則

| 想調整 | 修改 |
|---|---|
| 競賽時間 | `public/logic.js` 的 `MODES.standard.seconds` |
| 計分 | `public/logic.js` 的 `scoreRound` |
| 結局門檻 | `public/logic.js` 的 `pickEnding` |
| 答題後的停頓 | `public/logic.js` 的 `PAUSE_MS` |
| 開場倒數 | `config.js` 的 `game.startCountdownSeconds` |
| 榮譽榜名次、是否遮蔽姓名 | `config.js` 的 `leaderboard` |

榮譽榜的網址是公開的，所以姓名預設顯示成「王○明」，學號不會公開。

---

## 四、本機測試

```bash
npm install
npm test
```

要在本機開完整網站，先把 `wrangler.jsonc` 的資料庫 ID 換成任意 UUID，並建立 `.dev.vars`，內容寫 `ADMIN_PASSWORD=自訂密碼`，然後執行：

```bash
npm run dev
```
