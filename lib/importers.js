'use strict';
const { parseCsv, toRecords } = require('./csv');

const MAX_ROWS = 5000;

const STUDENT_COLUMNS = {
  student_id: ['學號', 'studentid', 'id', '學生編號'],
  name: ['姓名', '學生姓名'],
  class_name: ['班級', 'class', 'classname', '班'],
  seat_no: ['座號', 'seat', 'seatno'],
};

function normalizeStudentId(v) {
  return String(v ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toUpperCase();
}

async function importStudents(store, csvText, { deactivateMissing = false, now = Date.now() } = {}) {
  const parsed = parseCsv(csvText);
  const { columns, records, unknown } = toRecords(parsed, STUDENT_COLUMNS);
  const errors = [];
  const warnings = [];
  for (const need of ['student_id', 'name', 'class_name']) {
    if (!columns.includes(need)) {
      const label = { student_id: '學號', name: '姓名', class_name: '班級' }[need];
      errors.push(`找不到「${label}」欄位，請確認第一列的欄位名稱`);
    }
  }
  if (records.length > MAX_ROWS) errors.push(`一次最多匯入 ${MAX_ROWS} 筆`);
  if (unknown.length) warnings.push(`忽略不認得的欄位：${unknown.join('、')}`);
  if (errors.length) return { ok: false, errors, warnings };

  const rows = [];
  const seen = new Map();
  for (const { line, values } of records) {
    const id = normalizeStudentId(values.student_id);
    const name = (values.name || '').trim();
    const className = (values.class_name || '').trim();
    if (!id && !name && !className) continue;
    if (!id) errors.push(`第 ${line} 列：缺少學號`);
    else if (id.length > 30) errors.push(`第 ${line} 列：學號太長`);
    if (!name) errors.push(`第 ${line} 列：缺少姓名`);
    if (!className) errors.push(`第 ${line} 列：缺少班級`);
    if (id) {
      if (seen.has(id)) errors.push(`第 ${line} 列：學號 ${id} 與第 ${seen.get(id)} 列重複`);
      else seen.set(id, line);
    }
    rows.push({ id, name, className, seat: (values.seat_no || '').trim() || null });
  }
  if (!rows.length && !errors.length) errors.push('檔案裡沒有任何學生資料');
  if (errors.length) return { ok: false, errors: errors.slice(0, 100), warnings, total: rows.length };

  const existing = new Map((await store.all('SELECT student_id, name, class_name, seat_no, active FROM students')).map((r) => [r.student_id, r]));
  const ops = [];
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let deactivated = 0;
  for (const r of rows) {
    const old = existing.get(r.id);
    if (!old) inserted++;
    else if (old.name === r.name && old.class_name === r.className && (old.seat_no ?? null) === r.seat && old.active === 1) {
      unchanged++;
      continue; // 沒變動就不寫入（省 Cloudflare 免費額度）
    } else updated++;
    ops.push([`INSERT INTO students (student_id, name, class_name, seat_no, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(student_id) DO UPDATE SET name = excluded.name, class_name = excluded.class_name,
        seat_no = excluded.seat_no, active = 1, updated_at = excluded.updated_at`, [r.id, r.name, r.className, r.seat, now, now]]);
  }
  if (deactivateMissing) {
    const keep = new Set(rows.map((r) => r.id));
    for (const [id, old] of existing) {
      if (!keep.has(id) && old.active === 1) {
        deactivated++;
        ops.push(['UPDATE students SET active = 0, updated_at = ? WHERE student_id = ?', [now, id]]);
      }
    }
  }
  await store.batch(ops);
  const classes = [...new Set(rows.map((r) => r.className))];
  return { ok: true, total: rows.length, inserted, updated, unchanged, deactivated, classes, errors: [], warnings };
}

module.exports = { importStudents, normalizeStudentId };
