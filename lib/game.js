'use strict';
// 校內競賽核心：登入、開局、判分、結算、榮譽榜。計時與判分都在伺服器完成。
// 寫入量設計（Cloudflare D1 免費額度）：每送出一組包裹只更新 game_sessions 一列。
const L = require('../public/logic');
const { HttpError } = require('./errors');
const { normalizeStudentId } = require('./importers');

const READY_TOLERANCE_MS = 150; // 網路抖動容許：開放作答前 150ms 內送達的答案仍接受
const DURATION_MS = L.MODES.standard.seconds * 1000;

function randomToken() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function maskName(name) {
  const chars = [...String(name)];
  if (chars.length <= 1) return chars.join('');
  if (chars.length === 2) return `${chars[0]}○`;
  return `${chars[0]}${'○'.repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

function createGame({ store, config, stores, now = Date.now, rnd = Math.random }) {
  const natural = (a, b) => String(a).localeCompare(String(b), 'zh-Hant', { numeric: true });
  const TEST_IDS = new Set((config.testAccounts || []).map(normalizeStudentId));
  const isTest = (id) => TEST_IDS.has(id);
  const indexOf = new Map(stores.map((rec, i) => [rec, i]));
  const pick = L.createPicker(stores, rnd);

  async function studentRow(id) {
    if (isTest(id)) return { student_id: id, name: '測試帳號', class_name: '測試', active: 1 };
    return store.first('SELECT * FROM students WHERE student_id = ?', id);
  }

  async function getStudent(rawId) {
    const id = normalizeStudentId(rawId);
    const student = id ? await studentRow(id) : null;
    if (!student || !student.active) throw new HttpError(404, '找不到這個學號，請確認後再輸入', 'STUDENT_NOT_FOUND');
    return student;
  }

  async function bestOf(studentId) {
    if (isTest(studentId)) return 0;
    const b = await store.first('SELECT score FROM best_scores WHERE student_id = ?', studentId);
    return b ? b.score : 0;
  }

  async function login(rawId) {
    const student = await getStudent(rawId);
    return {
      student: { studentId: student.student_id, name: student.name, className: student.class_name },
      bestScore: await bestOf(student.student_id),
    };
  }

  const newRound = () => L.pickPair(pick).map((rec) => indexOf.get(rec));
  const packagesOf = (round) => round.map((i) => L.toPackage(stores[i]));
  const getSession = (token) => store.first('SELECT * FROM game_sessions WHERE token = ?', String(token || ''));

  async function start(rawId) {
    const student = await getStudent(rawId);
    const t = now();
    // 一般學號：重新開局時結束同一個人未完成的局（測試帳號多人共用，不互相結束）
    if (!isTest(student.student_id)) {
      const open = await store.all("SELECT * FROM game_sessions WHERE student_id = ? AND status = 'active'", student.student_id);
      for (const s of open) await finalize(s, t);
    }
    const playsAt = t + config.game.startCountdownSeconds * 1000;
    const round = newRound();
    const token = randomToken();
    await store.run(`INSERT INTO game_sessions (token, student_id, status, started_at, ends_at, next_at, round)
      VALUES (?, ?, 'active', ?, ?, ?, ?)`,
    token, student.student_id, t, playsAt + DURATION_MS, playsAt, JSON.stringify(round));
    return {
      sessionId: token,
      waitMs: playsAt - t,
      remainingMs: DURATION_MS,
      setNo: 1,
      round: packagesOf(round),
      student: { name: student.name, className: student.class_name },
    };
  }

  function validPicks(picks) {
    return Array.isArray(picks) && picks.length === 2
      && picks.every((p) => p && L.CITY_OPTIONS.includes(p.city) && L.DIST_OPTIONS.includes(p.dist));
  }

  async function answer({ sessionId, setNo, picks }) {
    if (!validPicks(picks)) throw new HttpError(400, '選項不正確', 'BAD_CHOICE');
    const t = now();
    const s = await getSession(sessionId);
    if (!s) throw new HttpError(404, '找不到這場遊戲', 'NO_SESSION');
    if (s.status === 'finished') return { finished: true };
    if (t > s.ends_at + config.game.graceMs) {
      await finalize(s, t);
      return { finished: true };
    }
    if (Number(setNo) !== s.sets + 1) throw new HttpError(409, '題目已更新，請重新同步', 'STALE');
    if (t < s.next_at - READY_TOLERANCE_MS) throw new HttpError(409, '還不能作答', 'NOT_READY', { waitMs: s.next_at - t });

    const roundIdx = JSON.parse(s.round);
    const recs = roundIdx.map((i) => stores[i]);
    const r = L.judgeRound(recs, picks, s.streak);
    const wrong = [];
    r.results.forEach((res, i) => {
      if (!res.cityOk || !res.distOk) wrong.push([roundIdx[i], picks[i].city, picks[i].dist]);
    });

    const timeUp = t >= s.ends_at;
    const nextRound = timeUp ? roundIdx : newRound();
    const pause = r.allCorrect ? L.PAUSE_MS.correct : L.PAUSE_MS.wrong;
    const score = s.score + r.gained;
    const items = s.items + 4;
    const correct = s.correct + r.okCount;
    const bestStreak = Math.max(s.best_streak, r.streak);
    // 樂觀鎖：只有 sets 還是原本的值才寫入，避免連點造成重複計分
    const upd = await store.run(`UPDATE game_sessions SET score = ?, sets = ?, items = ?, correct = ?, streak = ?, best_streak = ?,
        round = ?, next_at = ?, mistakes = ?
      WHERE id = ? AND sets = ? AND status = 'active'`,
    score, s.sets + 1, items, correct, r.streak, bestStreak, JSON.stringify(nextRound), t + pause,
    JSON.stringify(JSON.parse(s.mistakes).concat(wrong)), s.id, s.sets);
    if (!upd.changes) throw new HttpError(409, '題目已更新，請重新同步', 'STALE');

    return {
      results: r.results,
      allCorrect: r.allCorrect,
      gained: r.gained,
      score,
      streak: r.streak,
      setNo: s.sets + 2,
      next: timeUp ? null : packagesOf(nextRound),
      finished: timeUp,
      remainingMs: Math.max(0, s.ends_at - t),
    };
  }

  // 結束一局：標記完成 → 更新最佳成績。重複呼叫是安全的（只有第一次會生效）。
  async function finalize(s, t) {
    if (!s || s.status === 'finished') return;
    const finishedAt = Math.min(t, s.ends_at);
    if (isTest(s.student_id)) {
      await store.run("UPDATE game_sessions SET status = 'finished', finished_at = ? WHERE id = ? AND status = 'active'", finishedAt, s.id);
      return;
    }
    const prior = await store.first('SELECT score FROM best_scores WHERE student_id = ?', s.student_id);
    const prevBest = prior ? prior.score : null;
    const isNew = s.sets > 0 && prevBest !== null && s.score > prevBest;
    const claim = await store.run(
      "UPDATE game_sessions SET status = 'finished', finished_at = ?, prev_best = ?, is_new_record = ? WHERE id = ? AND status = 'active'",
      finishedAt, prevBest, isNew ? 1 : 0, s.id);
    if (!claim.changes || s.sets === 0) return;
    const accuracy = Math.round((s.correct / s.items) * 100);
    await store.run(`INSERT INTO best_scores (student_id, score, accuracy, sets, best_streak, finished_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(student_id) DO UPDATE SET score = excluded.score, accuracy = excluded.accuracy, sets = excluded.sets,
        best_streak = excluded.best_streak, finished_at = excluded.finished_at
      WHERE excluded.score > best_scores.score`,
    s.student_id, s.score, accuracy, s.sets, s.best_streak, finishedAt);
  }

  async function buildResult(s) {
    const test = isTest(s.student_id);
    let rank = null;
    if (s.sets > 0 && !test) {
      const me = await store.first('SELECT score FROM best_scores WHERE student_id = ?', s.student_id);
      if (me && me.score > 0) {
        const r = await store.first(`SELECT COUNT(*) + 1 AS rank FROM best_scores b JOIN students st ON st.student_id = b.student_id
          WHERE st.active = 1 AND b.score > ?`, me.score);
        rank = r.rank;
      }
    }
    const prev = s.prev_best;
    return {
      mode: 'standard',
      score: s.score,
      sets: s.sets,
      items: s.items,
      correct: s.correct,
      bestStreak: s.best_streak,
      rank,
      isTest: test,
      bestScore: Math.max(prev ?? 0, s.score),
      isNewRecord: !!s.is_new_record,
      review: JSON.parse(s.mistakes)
        .filter(([i]) => stores[i])
        .map(([i, city, dist]) => L.reviewItem(stores[i], { city, dist })),
    };
  }

  async function finish(token) {
    const t = now();
    let s = await getSession(token);
    if (!s) throw new HttpError(404, '找不到這場遊戲', 'NO_SESSION');
    if (s.status !== 'finished') {
      await finalize(s, t);
      s = await getSession(token);
    }
    return buildResult(s);
  }

  async function sweepExpired() {
    const t = now();
    const rows = await store.all("SELECT * FROM game_sessions WHERE status = 'active' AND ends_at < ? LIMIT 25", t - config.game.graceMs);
    for (const s of rows) await finalize(s, t);
    return rows.length;
  }

  async function leaderboard(className) {
    await sweepExpired();
    const classes = (await store.all('SELECT DISTINCT class_name FROM students WHERE active = 1')).map((r) => r.class_name).sort(natural);
    const filter = className && classes.includes(className) ? className : null;
    const rows = await store.all(`
      SELECT RANK() OVER (ORDER BY b.score DESC) AS rank, s.name, s.class_name, b.score
      FROM best_scores b JOIN students s ON s.student_id = b.student_id
      WHERE b.score > 0 AND s.active = 1 ${filter ? 'AND s.class_name = ?' : ''}
      ORDER BY b.score DESC, b.finished_at ASC, s.student_id ASC
      LIMIT ?`, ...(filter ? [filter] : []), config.leaderboard.size);
    return {
      classes,
      className: filter,
      entries: rows.map((r) => ({
        rank: r.rank,
        name: config.leaderboard.maskNames ? maskName(r.name) : r.name,
        className: r.class_name,
        bestScore: r.score,
      })),
    };
  }

  return { login, start, answer, finish, sweepExpired, leaderboard };
}

module.exports = { createGame, maskName };
