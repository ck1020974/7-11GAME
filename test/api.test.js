'use strict';
// 用假的時鐘跑完整 API 流程（不需要真的等 3 分鐘）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const stores = require('../public/stores.json');
const L = require('../public/logic');
const { openStore } = require('../lib/db');
const { createApp } = require('../lib/app');
const { importStudents } = require('../lib/importers');
const { maskName } = require('../lib/game');

let clock = 1_800_000_000_000;
let store;
let app;

async function call(p, body, headers = {}) {
  const init = body === undefined ? { headers } : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) };
  const res = await app.handle(new Request(`https://game.test${p}`, init), { ip: '1.2.3.4' });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

// 依資料庫裡的正確答案作答；wrong = true 時全部選錯
async function picksFor(sessionId, wrong = false) {
  const s = await store.first('SELECT round FROM game_sessions WHERE token = ?', sessionId);
  return JSON.parse(s.round).map((i) => {
    const city = L.classifyCityType(stores[i].縣市);
    const dist = L.classifyDistrictType(stores[i].鄉鎮市區);
    return wrong
      ? { city: L.CITY_OPTIONS.find((x) => x !== city), dist: L.DIST_OPTIONS.find((x) => x !== dist) }
      : { city, dist };
  });
}

test.before(async () => {
  store = await openStore(':memory:');
  await importStudents(store, fs.readFileSync(path.join(__dirname, '..', 'samples', 'students.sample.csv'), 'utf8'));
  app = createApp({ store, config, stores, adminPassword: 'teacher-pass', now: () => clock });
});

test('找不到學號', async () => {
  assert.equal((await call('/api/login', { studentId: 'NOPE' })).status, 404);
});

test('完整一局：倒數、計分、連對、答錯紀錄、時間到、榮譽榜', async () => {
  const login = await call('/api/login', { studentId: 'lj14001' });
  assert.equal(login.data.student.name, '王小明', '學號不分大小寫');

  const s = (await call('/api/game/start', { studentId: 'LJ14001' })).data;
  assert.equal(s.waitMs, 3000);
  const shown = JSON.stringify(s.round);
  assert.ok(!/"縣市"|"鄉鎮市區"|fullCity/.test(shown), '題目不能附帶完整地名');

  let picks = await picksFor(s.sessionId);
  let r = await call('/api/game/answer', { sessionId: s.sessionId, setNo: 1, picks });
  assert.equal(r.data.code, 'NOT_READY', '開場倒數中不能作答');

  clock += 3000;
  r = await call('/api/game/answer', { sessionId: s.sessionId, setNo: 1, picks });
  assert.equal(r.data.gained, 30);
  assert.equal(r.data.streak, 1);
  assert.equal(r.data.setNo, 2);

  // 重送同一組不能重複計分
  clock += L.PAUSE_MS.correct;
  r = await call('/api/game/answer', { sessionId: s.sessionId, setNo: 1, picks });
  assert.equal(r.data.code, 'STALE');

  picks = await picksFor(s.sessionId);
  r = await call('/api/game/answer', { sessionId: s.sessionId, setNo: 2, picks });
  assert.equal(r.data.gained, 32, '連對第二組多 2 分');

  // 停頓還沒結束不能送下一組
  clock += 100;
  picks = await picksFor(s.sessionId, true);
  r = await call('/api/game/answer', { sessionId: s.sessionId, setNo: 3, picks });
  assert.equal(r.data.code, 'NOT_READY', '不能跳過答題後的停頓');

  clock += L.PAUSE_MS.correct;
  r = await call('/api/game/answer', { sessionId: s.sessionId, setNo: 3, picks });
  assert.equal(r.data.gained, 0);
  assert.equal(r.data.streak, 0);

  // 時間到後超過寬限就不再收答案
  clock += 180_000 + config.game.graceMs + 1;
  picks = await picksFor(s.sessionId);
  r = await call('/api/game/answer', { sessionId: s.sessionId, setNo: 4, picks });
  assert.equal(r.data.finished, true);

  const f = (await call('/api/game/finish', { sessionId: s.sessionId })).data;
  assert.equal(f.score, 62);
  assert.equal(f.sets, 3);
  assert.equal(f.items, 12);
  assert.equal(f.correct, 8);
  assert.equal(f.rank, 1);
  assert.equal(f.review.length, 2, '解答列出答錯的兩件包裹');
  assert.ok(f.review[0].why.length > 0);

  const board = (await call('/api/leaderboard')).data;
  assert.equal(board.entries[0].name, '王○明', '榮譽榜遮蔽姓名');
  assert.equal(board.entries[0].bestScore, 62);
  assert.ok(!JSON.stringify(board).includes('LJ14001'), '榮譽榜不公開學號');
});

test('分數較低不會蓋掉最高分', async () => {
  clock += 1000;
  const s = (await call('/api/game/start', { studentId: 'LJ14001' })).data;
  clock += 3000;
  await call('/api/game/answer', { sessionId: s.sessionId, setNo: 1, picks: await picksFor(s.sessionId, true) });
  const f = (await call('/api/game/finish', { sessionId: s.sessionId })).data;
  assert.equal(f.score, 0);
  assert.equal(f.bestScore, 62);
  assert.equal((await call('/api/leaderboard')).data.entries[0].bestScore, 62);
});

test('測試帳號不上榜', async () => {
  const s = (await call('/api/game/start', { studentId: 'LJ140000' })).data;
  clock += 3000;
  await call('/api/game/answer', { sessionId: s.sessionId, setNo: 1, picks: await picksFor(s.sessionId) });
  const f = (await call('/api/game/finish', { sessionId: s.sessionId })).data;
  assert.equal(f.isTest, true);
  assert.equal(f.rank, null);
  assert.equal((await call('/api/leaderboard')).data.entries.length, 1);
});

test('班級篩選與同學排名', async () => {
  clock += 1000;
  const s = (await call('/api/game/start', { studentId: 'LJ14003' })).data;
  clock += 3000;
  await call('/api/game/answer', { sessionId: s.sessionId, setNo: 1, picks: await picksFor(s.sessionId) });
  const f = (await call('/api/game/finish', { sessionId: s.sessionId })).data;
  assert.equal(f.rank, 2);
  const board = (await call(`/api/leaderboard?class=${encodeURIComponent('802')}`)).data;
  assert.deepEqual(board.classes, ['801', '802']);
  assert.equal(board.entries.length, 1);
  assert.equal(board.entries[0].className, '802');
});

test('亂傳選項會被擋下', async () => {
  const s = (await call('/api/game/start', { studentId: 'LJ14002' })).data;
  clock += 3000;
  const r = await call('/api/game/answer', { sessionId: s.sessionId, setNo: 1, picks: [{ city: '市', dist: '區' }, { city: '縣', dist: '鄉' }] });
  assert.equal(r.status, 400);
  assert.equal((await call('/api/game/answer', { sessionId: s.sessionId, setNo: 1, picks: 'x' })).status, 400);
});

test('教師後台需要密碼，匯出與清除成績可用', async () => {
  assert.equal((await call('/api/admin/students')).status, 401);
  const xhr = { 'X-Requested-With': 'rp-admin' };
  const login = await call('/api/admin/login', { password: 'teacher-pass' }, xhr);
  assert.equal(login.status, 200);
  const cookie = { cookie: login.headers.get('set-cookie').split(';')[0] };
  const students = (await call('/api/admin/students', undefined, cookie)).data.students;
  assert.equal(students.length, 3);
  assert.equal(students.find((s) => s.studentId === 'LJ14001').bestScore, 62);
  assert.match((await call('/api/admin/export/students.csv', undefined, cookie)).data, /王小明/);
  assert.equal((await call('/api/admin/reset-scores', { confirm: '不對' }, { ...xhr, ...cookie })).status, 400);
  assert.equal((await call('/api/admin/reset-scores', { confirm: '確認清除' }, { ...xhr, ...cookie })).status, 200);
  assert.equal((await call('/api/leaderboard')).data.entries.length, 0);
});

test('姓名遮蔽', () => {
  assert.equal(maskName('王小明'), '王○明');
  assert.equal(maskName('李華'), '李○');
  assert.equal(maskName('歐陽小明'), '歐○○明');
});

test('所有門市的分類一致', () => {
  for (const rec of stores) {
    const c = L.classifyCityType(rec.縣市);
    const d = L.classifyDistrictType(rec.鄉鎮市區);
    assert.notEqual(c, '未知');
    assert.notEqual(d, '未知');
    assert.notEqual(c === '縣', d === '區', `${rec.縣市}${rec.鄉鎮市區}`);
  }
});
