'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const state = { cls: '', students: [], sort: ['className', 1] };

  async function api(path, body) {
    const opt = { headers: { 'X-Requested-With': 'rp-admin' } };
    if (body !== undefined) {
      opt.method = 'POST';
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    let res;
    try { res = await fetch(path, opt); } catch { throw new Error('連不上伺服器'); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.endsWith('/login')) { showLogin(); throw new Error(data.error || '請重新登入'); }
    if (!res.ok) throw new Error(data.error || `發生錯誤（${res.status}）`);
    return data;
  }

  const show = (id) => document.querySelectorAll('.screen').forEach((s) => s.toggleAttribute('data-active', s.id === id));
  let toastTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  const fmtPct = (x) => (x == null ? '—' : `${Math.round(x * 1000) / 10}%`);
  const dtf = new Intl.DateTimeFormat('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const fmtTime = (ms) => (ms ? dtf.format(new Date(ms)) : '—');
  const accClass = (x) => (x == null ? '' : x < 0.6 ? 'acc-low' : x < 0.75 ? 'acc-mid' : '');
  const qs = () => (state.cls ? `?class=${encodeURIComponent(state.cls)}` : '');

  function td(text, cls) {
    const el = document.createElement('td');
    if (text instanceof Node) el.append(text); else el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }
  function emptyRow(tbody, cols, text) {
    const tr = document.createElement('tr'); tr.className = 'empty-row';
    const c = td(text); c.colSpan = cols; tr.append(c); tbody.replaceChildren(tr);
  }

  // ── 排序 ─────────────────────────────────────────
  const collator = new Intl.Collator('zh-Hant', { numeric: true });
  function sortRows(rows, [key, dir]) {
    return rows.slice().sort((a, b) => {
      const x = a[key];
      const y = b[key];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
      return r * dir;
    });
  }
  $('s-table').querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const [k, d] = state.sort;
      const numeric = th.classList.contains('num') || th.dataset.sort === 'lastPlayed';
      state.sort = [th.dataset.sort, k === th.dataset.sort ? -d : numeric ? -1 : 1];
      renderStudents();
    });
  });
  function markSorted([key, dir]) {
    $('s-table').querySelectorAll('th[data-sort]').forEach((th) => {
      th.classList.toggle('sorted-asc', th.dataset.sort === key && dir === 1);
      th.classList.toggle('sorted-desc', th.dataset.sort === key && dir === -1);
    });
  }

  // ── 學生 ─────────────────────────────────────────
  function renderStudents() {
    const q = $('s-search').value.trim().toLowerCase();
    const playedOnly = $('s-played').checked;
    let rows = state.students.filter((s) => (!playedOnly || s.plays > 0) && (!q || s.studentId.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)));
    rows = sortRows(rows, state.sort);
    markSorted(state.sort);
    const tbody = $('s-table').tBodies[0];
    if (!rows.length) return emptyRow(tbody, 10, state.students.length ? '沒有符合條件的學生' : '還沒有學生名單，請到「匯入名單」匯入');
    const frag = document.createDocumentFragment();
    for (const s of rows) {
      const tr = document.createElement('tr');
      tr.className = `clickable${s.active ? '' : ' inactive'}`;
      tr.tabIndex = 0;
      tr.append(td(s.className), td(s.seatNo ?? '', 'num seat'), td(s.studentId), td(s.active ? s.name : `${s.name}（停用）`),
        td(s.plays ? s.bestScore.toLocaleString() : '—', 'num'), td(s.plays, 'num'),
        td(fmtPct(s.accuracy), `num ${accClass(s.accuracy)}`), td(s.sets, 'num'), td(s.bestStreak, 'num'), td(fmtTime(s.lastPlayed)));
      const open = () => openStudent(s);
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
      frag.append(tr);
    }
    tbody.replaceChildren(frag);
  }

  async function openStudent(s) {
    $('s-dialog-title').textContent = `${s.className} ${s.name}（${s.studentId}）`;
    const tbody = $('s-dialog-body');
    emptyRow(tbody, 6, '載入中…');
    $('s-dialog').showModal();
    try {
      const { sessions } = await api(`/api/admin/students/${encodeURIComponent(s.studentId)}/sessions`);
      if (!sessions.length) return emptyRow(tbody, 6, '這位學生還沒有玩過');
      const best = Math.max(...sessions.map((x) => x.score));
      tbody.replaceChildren(...sessions.map((x) => {
        const tr = document.createElement('tr');
        const mark = document.createElement('span');
        if (x.score === best) { mark.className = 'badge-new'; mark.textContent = '最高分'; }
        tr.append(td(fmtTime(x.finishedAt)), td(x.score.toLocaleString(), 'num'), td(x.sets, 'num'),
          td(fmtPct(x.accuracy), `num ${accClass(x.accuracy)}`), td(x.bestStreak, 'num'), td(mark));
        return tr;
      }));
    } catch (e) {
      emptyRow(tbody, 6, e.message);
    }
  }

  // ── 載入 ─────────────────────────────────────────
  async function loadAll() {
    try {
      const [ov, st] = await Promise.all([api(`/api/admin/overview${qs()}`), api(`/api/admin/students${qs()}`)]);
      const sel = $('a-class');
      sel.replaceChildren(new Option('全部班級', ''), ...ov.classes.map((c) => new Option(c, c)));
      sel.value = ov.classes.includes(state.cls) ? state.cls : '';
      document.querySelectorAll('#a-overview dd').forEach((dd) => { dd.textContent = Number(ov[dd.dataset.k] || 0).toLocaleString(); });
      state.students = st.students;
      renderStudents();
      document.querySelectorAll('.a-exp').forEach((a) => {
        const kind = a.dataset.exp;
        a.href = `/api/admin/export/${kind}.csv${kind === 'students-list' ? '' : qs()}`;
      });
    } catch (e) {
      toast(e.message);
    }
  }

  $('reset-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const box = ev.target.querySelector('.imp-result');
    const btn = ev.target.querySelector('button');
    btn.disabled = true;
    try {
      const r = await api('/api/admin/reset-scores', { confirm: $('reset-confirm').value.trim() });
      box.className = 'imp-result ok';
      box.textContent = `已清除 ${r.deletedSessions} 局遊玩紀錄，榮譽榜已歸零。`;
      $('reset-confirm').value = '';
      loadAll();
    } catch (e) {
      box.className = 'imp-result fail';
      box.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ── 匯入 ─────────────────────────────────────────
  async function readCsvFile(file) {
    const buf = await file.arrayBuffer();
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      return new TextDecoder('big5').decode(buf); // Excel 預設存成 Big5 的 CSV
    }
  }

  function showImportResult(box, r) {
    box.className = `imp-result ${r.ok ? 'ok' : 'fail'}`;
    box.replaceChildren();
    const head = document.createElement('b');
    head.textContent = r.ok
      ? `匯入成功：共 ${r.total} 筆，新增 ${r.inserted}、更新 ${r.updated}${r.unchanged ? `、未變動 ${r.unchanged}` : ''}${r.deactivated ? `、停用 ${r.deactivated}` : ''}`
      : '沒有匯入任何資料，請修正下列問題後重新上傳';
    box.append(head);
    const items = [...(r.errors || []).map((t) => ['err', t]), ...(r.warnings || []).map((t) => ['warn', t])];
    if (items.length) {
      const ul = document.createElement('ul');
      for (const [c, t] of items) { const li = document.createElement('li'); li.className = c; li.textContent = t; ul.append(li); }
      box.append(ul);
    }
  }

  $('imp-students').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const file = form.querySelector('input[type=file]').files[0];
    const box = form.querySelector('.imp-result');
    const btn = form.querySelector('button[type=submit]');
    if (!file) return;
    btn.disabled = true;
    try {
      const csv = await readCsvFile(file);
      const r = await api('/api/admin/import/students', { csv, deactivateMissing: form.elements.deactivateMissing.checked });
      showImportResult(box, r);
      if (r.ok) { form.reset(); loadAll(); }
    } catch (e) {
      showImportResult(box, { ok: false, errors: [e.message] });
    } finally {
      btn.disabled = false;
    }
  });

  // ── 登入／分頁 ───────────────────────────────────
  function showLogin() { show('a-login'); $('a-password').focus(); }

  $('a-login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('a-login-error').textContent = '';
    try {
      await api('/api/admin/login', { password: $('a-password').value });
      $('a-password').value = '';
      show('a-main');
      loadAll();
    } catch (e) {
      $('a-login-error').textContent = e.message;
    }
  });
  $('a-logout').addEventListener('click', async () => { try { await api('/api/admin/logout', {}); } catch { /* ignore */ } showLogin(); });
  $('a-class').addEventListener('change', (e) => { state.cls = e.target.value; loadAll(); });
  document.querySelectorAll('.a-tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.a-tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    document.querySelectorAll('.a-tab').forEach((t) => { t.hidden = t.id !== `tab-${b.dataset.tab}`; });
  }));
  $('s-search').addEventListener('input', renderStudents);
  $('s-played').addEventListener('change', renderStudents);

  (async () => {
    try {
      const me = await api('/api/admin/me');
      if (!me.enabled) {
        showLogin();
        $('a-login-error').textContent = '後台尚未啟用：請在 Cloudflare 的 Worker 設定中新增 Secret「ADMIN_PASSWORD」（至少 8 個字元）';
        return;
      }
      if (me.authed) { show('a-main'); loadAll(); } else showLogin();
    } catch (e) {
      showLogin();
      $('a-login-error').textContent = e.message;
    }
  })();
})();
