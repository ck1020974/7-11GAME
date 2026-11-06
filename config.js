'use strict';
/**
 * 遊戲設定檔：校內競賽可調整的數值集中在這裡。
 * 修改後更新到 GitHub，Cloudflare 會自動重新部署。
 * 計分、競賽時間、結局門檻在 public/logic.js（前後端共用）。
 */
module.exports = {
  game: {
    startCountdownSeconds: 3, // 按下開始後的 3-2-1 倒數（不計入遊戲時間）
    graceMs: 1000, // 時間到之後，仍接受「網路延遲中」的最後一組答案（毫秒）
  },

  // 任何人都能用這些學號試玩：不必匯入名單、不上榮譽榜、不計入後台統計。
  testAccounts: [
    { id: 'LJ140000', name: '測試帳號', className: '測試' },
    { id: 'LJ14000', name: '李祐馨', className: '801' },
  ],

  leaderboard: {
    size: 10, // 榮譽榜顯示名次數
    maskNames: true, // 網址是公開的，榮譽榜上的姓名顯示成「王○明」；設 false 顯示全名
  },

  timezone: 'Asia/Taipei', // 匯出資料的時間顯示時區

  // 防濫用（以來源 IP 計算；全校共用學校 Wi-Fi 時是同一個 IP，所以設高一點）
  limits: {
    loginPerMinutePerIp: 1000,
    adminLoginFailures: 10, // 教師後台：連續輸入錯誤密碼幾次後暫時鎖定
    adminLoginWindowMinutes: 15,
  },
};
