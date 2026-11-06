'use strict';
// 教師後台：統計查詢與 CSV 匯出（只在通過後台驗證後才會被呼叫）。
const { toCsv } = require('./csv');

function createAdmin({ store, config }) {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: config.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const time = (ms) => (ms ? fmt.format(new Date(ms)) : '');
  const natural = (a, b) => String(a).localeCompare(String(b), 'zh-Hant', { numeric: true });
  const cls = (c) => (c ? String(c) : null);

  async function classes() {
    return (await store.all('SELECT DISTINCT class_name FROM students WHERE active = 1')).map((r) => r.class_name).sort(natural);
  }

  async function overview(className) {
    const c = cls(className);
    const students = await store.first('SELECT COUNT(*) AS n FROM students WHERE active = 1 AND (? IS NULL OR class_name = ?)', c, c);
    const games = await store.first(`SELECT COUNT(DISTINCT g.student_id) AS players, COUNT(*) AS sessions, COALESCE(SUM(g.sets), 0) AS sets
      FROM game_sessions g JOIN students s ON s.student_id = g.student_id
      WHERE g.status = 'finished' AND g.sets > 0 AND (? IS NULL OR s.class_name = ?)`, c, c);
    return { students: students.n, players: games.players, sessions: games.sessions, sets: games.sets };
  }

  async function students(className) {
    const c = cls(className);
    const rows = await store.all(`
      SELECT st.student_id, st.name, st.class_name, st.seat_no, st.active,
             b.score AS best_score, b.best_streak,
             p.plays, p.sets, p.items, p.correct, p.last_played
      FROM students st
      LEFT JOIN best_scores b ON b.student_id = st.student_id
      LEFT JOIN (
        SELECT student_id, COUNT(*) AS plays, SUM(sets) AS sets, SUM(items) AS items, SUM(correct) AS correct,
               MAX(finished_at) AS last_played
        FROM game_sessions WHERE status = 'finished' AND sets > 0 GROUP BY student_id
      ) p ON p.student_id = st.student_id
      WHERE (? IS NULL OR st.class_name = ?)`, c, c);
    return rows
      .map((r) => ({
        studentId: r.student_id, name: r.name, className: r.class_name, seatNo: r.seat_no, active: !!r.active,
        bestScore: r.best_score || 0, plays: r.plays || 0, sets: r.sets || 0,
        accuracy: r.items ? r.correct / r.items : null, bestStreak: r.best_streak || 0, lastPlayed: r.last_played || null,
      }))
      .sort((a, b) => natural(a.className, b.className) || natural(a.seatNo ?? '', b.seatNo ?? '') || natural(a.studentId, b.studentId));
  }

  async function studentSessions(studentId) {
    const rows = await store.all(`SELECT token, finished_at, score, sets, items, correct, best_streak
      FROM game_sessions WHERE student_id = ? AND status = 'finished' AND sets > 0 ORDER BY finished_at DESC`, String(studentId));
    return rows.map((r) => ({
      id: r.token, finishedAt: r.finished_at, score: r.score, sets: r.sets,
      accuracy: r.items ? r.correct / r.items : null, bestStreak: r.best_streak,
    }));
  }

  const pct = (x) => (x == null ? '' : Math.round(x * 1000) / 10);

  // 回傳 { filename, body } 或 null
  async function exportCsv(kind, className) {
    const c = cls(className);
    const tag = c ? `_${c}` : '';
    const date = time(Date.now()).slice(0, 10);
    switch (kind) {
      case 'students':
        return {
          filename: `學生成績總表${tag}_${date}.csv`,
          body: toCsv(['學號', '姓名', '班級', '座號', '最高分', '遊玩次數', '完成組數', '正確率(%)', '最高連對', '最近遊玩時間'],
            (await students(c)).map((s) => [s.studentId, s.name, s.className, s.seatNo, s.bestScore, s.plays, s.sets, pct(s.accuracy), s.bestStreak, time(s.lastPlayed)])),
        };
      case 'sessions': {
        const rows = await store.all(`SELECT g.token, g.student_id, s.name, s.class_name, g.finished_at, g.score, g.sets, g.items, g.correct, g.best_streak, g.is_new_record
          FROM game_sessions g JOIN students s ON s.student_id = g.student_id
          WHERE g.status = 'finished' AND g.sets > 0 AND (? IS NULL OR s.class_name = ?) ORDER BY g.finished_at`, c, c);
        return {
          filename: `每局成績${tag}_${date}.csv`,
          body: toCsv(['場次ID', '學號', '姓名', '班級', '結束時間', '分數', '完成組數', '正確率(%)', '最高連對', '刷新個人紀錄'],
            rows.map((g) => [g.token, g.student_id, g.name, g.class_name, time(g.finished_at), g.score, g.sets, pct(g.correct / g.items), g.best_streak, g.is_new_record ? '是' : '否'])),
        };
      }
      case 'students-list':
        return {
          filename: `學生名單_${date}.csv`,
          body: toCsv(['學號', '姓名', '班級', '座號'],
            (await store.all('SELECT student_id, name, class_name, seat_no FROM students WHERE active = 1'))
              .sort((a, b) => natural(a.class_name, b.class_name) || natural(a.seat_no ?? '', b.seat_no ?? ''))
              .map((s) => [s.student_id, s.name, s.class_name, s.seat_no])),
        };
      default:
        return null;
    }
  }

  // 清除成績（新學期或新一輪比賽）：名單保留
  async function resetScores() {
    const n = await store.first('SELECT COUNT(*) AS n FROM game_sessions');
    await store.batch([['DELETE FROM game_sessions', []], ['DELETE FROM best_scores', []]]);
    return { deletedSessions: n.n };
  }

  return { classes, overview, students, studentSessions, exportCsv, resetScores };
}

module.exports = { createAdmin };
