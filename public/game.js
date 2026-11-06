(function () {
  const L = window.GameLogic;
  const $ = (id) => document.getElementById(id);

  const params = new URLSearchParams(location.search);
  const modeKey = L.MODES[params.get("mode")] ? params.get("mode") : "standard";
  const mode = L.MODES[modeKey];

  const state = {
    round: [],
    choice: [{}, {}],
    locked: true,
    over: false,
    busy: null,
    timeLeftMs: (mode.seconds || 0) * 1000,
    lastTick: 0,
    timerOn: false,
    setNo: 1,
    streak: 0,
    keyboard: false,
  };

  // ====== 兩種出題來源：校內競賽走伺服器，其他模式在瀏覽器裡跑 ======
  function localBackend(stores) {
    const pick = L.createPicker(stores);
    const deck = modeKey === "review" ? Store.get("review-deck", []) : [];
    const total = deck.length;
    const log = { score: 0, sets: 0, items: 0, correct: 0, bestStreak: 0, streak: 0, review: [] };
    let recs = [];
    const draw = () => {
      if (modeKey !== "review") return L.pickPair(pick);
      const a = deck.shift() || pick();
      let b = deck.shift() || pick();
      while (b.門市名稱 === a.門市名稱) b = pick();
      return [a, b];
    };
    const toPackages = () => recs.map(L.toPackage);
    return {
      async start() {
        if (modeKey === "review" && !total) throw new Error("no-deck");
        recs = draw();
        return { waitMs: 0, remainingMs: state.timeLeftMs, setNo: 1, round: toPackages() };
      },
      async answer(picks) {
        const r = L.judgeRound(recs, picks, log.streak);
        log.streak = r.streak;
        log.bestStreak = Math.max(log.bestStreak, r.streak);
        log.score += r.gained;
        log.sets++;
        log.items += 4;
        log.correct += r.okCount;
        r.results.forEach((res, i) => {
          if (res.cityOk && res.distOk) return;
          log.review.push(L.reviewItem(recs[i], picks[i]));
          if (modeKey === "review") deck.push(recs[i]);
        });
        const finished = (mode.sets && log.sets >= mode.sets) || (modeKey === "review" && !deck.length);
        if (!finished) recs = draw();
        return {
          results: r.results,
          allCorrect: r.allCorrect,
          gained: r.gained,
          score: log.score,
          streak: r.streak,
          setNo: log.sets + 1,
          next: finished ? null : toPackages(),
          finished,
        };
      },
      async finish() {
        return { mode: modeKey, ...log };
      },
    };
  }

  function rankedBackend(student) {
    let sessionId = null;
    let setNo = 1;
    return {
      async start() {
        const s = await api("/api/game/start", { studentId: student.studentId });
        sessionId = s.sessionId;
        return s;
      },
      async answer(picks) {
        const r = await withRetry(() => api("/api/game/answer", { sessionId, setNo, picks }));
        if (r.setNo) setNo = r.setNo;
        return r;
      },
      finish: () => withRetry(() => api("/api/game/finish", { sessionId })),
    };
  }

  // 校園 Wi-Fi 偶爾掉一下，連線問題重試幾次
  async function withRetry(fn) {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (err) {
        if (err.status || i >= 3) throw err;
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }
  }

  // ====== 音效 ======
  const sound = (function () {
    let ctx = null;
    let muted = Store.get("muted", false);
    const btn = $("mute");
    const paint = () => {
      btn.textContent = muted ? "🔇" : "🔊";
      btn.setAttribute("aria-label", muted ? "開啟音效" : "關閉音效");
    };
    function tone(freq, at, len) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + len);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + len);
    }
    const play = (notes) => {
      if (muted || !ctx) return;
      notes.forEach(([f, at, len]) => tone(f, at, len));
    };
    btn.addEventListener("click", () => {
      muted = !muted;
      Store.set("muted", muted);
      paint();
    });
    paint();
    return {
      unlock() {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!ctx && AC) ctx = new AC();
      },
      good: () => play([[660, 0, 0.1], [880, 0.09, 0.16]]),
      bad: () => play([[196, 0, 0.22]]),
    };
  })();

  // ====== 建立卡片 ======
  function buildCard(i) {
    const card = $("card" + i);
    card.innerHTML = `
      <div class="ticket">
        <img class="logo" src="picture/logo.webp" alt="" />
        <p class="place" id="place${i}"></p>
        <p class="address" id="addr${i}"></p>
      </div>
      <div class="answers">
        <div class="btn-row" role="group" aria-label="縣市層級" data-kind="city"></div>
        <div class="btn-row" role="group" aria-label="鄉鎮市區層級" data-kind="dist"></div>
      </div>`;
    const rows = card.querySelectorAll(".btn-row");
    [[rows[0], L.CITY_OPTIONS], [rows[1], L.DIST_OPTIONS]].forEach(([row, options]) => {
      options.forEach((value) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "gbtn";
        btn.dataset.value = value;
        btn.textContent = row.dataset.kind === "dist" ? L.districtLabel(value) : value;
        btn.setAttribute("aria-pressed", "false");
        row.append(btn);
      });
      row.addEventListener("click", (e) => {
        const btn = e.target.closest(".gbtn");
        if (btn) choose(i, row, btn);
      });
    });
  }

  function choose(i, row, btn) {
    if (state.locked || state.over) return;
    sound.unlock();
    row.querySelectorAll(".gbtn").forEach((b) => {
      b.classList.toggle("is-active", b === btn);
      b.setAttribute("aria-pressed", String(b === btn));
    });
    state.choice[i][row.dataset.kind] = btn.dataset.value;
    if (state.choice.every((c) => c.city && c.dist)) submit();
  }

  // ====== 回合 ======
  function showRound(round, setNo) {
    state.round = round;
    state.setNo = setNo;
    state.choice = [{}, {}];
    round.forEach((pkg, i) => {
      $("place" + i).textContent = `${pkg.cityLabel}・${pkg.distLabel}`;
      $("place" + i).classList.remove("revealed");
      $("addr" + i).textContent = `${pkg.name}　${pkg.address}`;
    });
    document.querySelectorAll(".card .gbtn").forEach((b) => {
      b.classList.remove("is-active", "correct-hint", "error-choice");
      b.setAttribute("aria-pressed", "false");
    });
    document.querySelectorAll(".card").forEach((c) => c.classList.remove("shake-effect"));
    setSad(false);
    state.locked = false;
    renderTime();
    if (state.keyboard) document.querySelector("#card0 .gbtn").focus({ preventScroll: true });
  }

  function setSad(sad) {
    $("boy1").classList.toggle("hidden", sad);
    $("girl1").classList.toggle("hidden", sad);
    $("boy3").classList.toggle("hidden", !sad);
    $("girl3").classList.toggle("hidden", !sad);
  }

  function replay(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function mark(i, kind, correct, chosen) {
    $("card" + i).querySelectorAll(`[data-kind="${kind}"] .gbtn`).forEach((b) => {
      if (b.dataset.value === correct) b.classList.add("correct-hint");
      else if (b.dataset.value === chosen) b.classList.add("error-choice");
    });
  }

  async function submit() {
    state.locked = true;
    const picks = state.choice;
    let res;
    state.busy = backend.answer(picks);
    try {
      res = await state.busy;
    } catch (err) {
      return failAndLeave(err);
    } finally {
      state.busy = null;
    }
    if (!res.results) return endGame(); // 伺服器判定時間已到

    res.results.forEach((r, i) => {
      mark(i, "city", r.city, picks[i].city);
      mark(i, "dist", r.dist, picks[i].dist);
      if (r.cityOk && r.distOk) return;
      $("place" + i).textContent = `${r.fullCity}・${r.fullDist}`;
      $("place" + i).classList.add("revealed");
    });

    state.streak = res.streak;
    $("scoreValue").textContent = res.score;
    if (res.gained) {
      $("gain").textContent = `+${res.gained}`;
      replay($("gain"), "show");
    }
    renderCombo();
    if (res.remainingMs !== undefined) state.timeLeftMs = res.remainingMs;

    if (res.allCorrect) {
      sound.good();
      replay($("truck"), "truck-drive-out");
      $("live").textContent = `全對，加 ${res.gained} 分`;
    } else {
      sound.bad();
      setSad(true);
      document.querySelectorAll(".card").forEach((c) => replay(c, "shake-effect"));
      $("live").textContent = "有答錯，看一下正解";
    }

    const pause = res.allCorrect ? L.PAUSE_MS.correct : L.PAUSE_MS.wrong;
    setTimeout(() => {
      if (state.over) return;
      const outOfTime = mode.seconds && state.timeLeftMs <= 0;
      if (res.finished || outOfTime || !res.next) endGame();
      else showRound(res.next, res.setNo);
    }, pause);
  }

  function renderCombo() {
    const el = $("combo");
    el.hidden = state.streak < 2;
    el.textContent = `連對 ${state.streak}`;
  }

  // ====== 計時 ======
  function renderTime() {
    if (!mode.seconds) {
      $("timeValue").textContent = mode.sets ? `${state.setNo}/${mode.sets}` : `${state.setNo}`;
      return;
    }
    const s = Math.ceil(state.timeLeftMs / 1000);
    $("timeValue").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    $("time").classList.toggle("low", s <= 15);
  }

  function tick() {
    const now = performance.now();
    const dt = now - state.lastTick;
    state.lastTick = now;
    if (!mode.seconds || !state.timerOn || state.over) return;
    if (!mode.ranked && document.hidden) return; // 校內競賽以伺服器時間為準，切換分頁不暫停
    state.timeLeftMs = Math.max(0, state.timeLeftMs - dt);
    renderTime();
    if (state.timeLeftMs <= 0) endGame();
  }

  async function endGame() {
    if (state.over) return;
    state.over = true;
    state.locked = true;
    clearInterval(state.timer);
    try {
      if (state.busy) await state.busy.catch(() => {});
      const result = await backend.finish();
      sessionStorage.setItem("last-result", JSON.stringify(result));
      location.replace(result.items ? "end.html" : "index.html");
    } catch (err) {
      failAndLeave(err);
    }
  }

  function failAndLeave(err) {
    state.over = true;
    clearInterval(state.timer);
    $("overlay").hidden = false;
    $("overlayText").textContent = err.message || "連線中斷";
    $("overlayNote").textContent = "已送出的成績會保留，三秒後回首頁";
    setTimeout(() => location.replace("index.html"), 3000);
  }

  function countdown(ms) {
    return new Promise((resolve) => {
      if (ms <= 0) return resolve();
      const end = performance.now() + ms;
      $("overlay").hidden = false;
      $("overlayNote").textContent = student ? `${student.className} ${student.name}` : "";
      (function step() {
        const left = end - performance.now();
        if (left <= 0) {
          $("overlay").hidden = true;
          return resolve();
        }
        $("overlayText").textContent = Math.ceil(left / 1000);
        setTimeout(step, 100);
      })();
    });
  }

  // ====== 啟動 ======
  let backend;
  const student = mode.ranked ? JSON.parse(sessionStorage.getItem("student") || "null") : null;

  async function boot() {
    if (mode.ranked && !student) {
      location.replace("index.html");
      return;
    }
    [0, 1].forEach(buildCard);
    $("quit").addEventListener("click", endGame);
    window.addEventListener("keydown", (e) => {
      if (e.key === "Tab" || e.key === "Enter" || e.key === " ") state.keyboard = true;
    });
    window.addEventListener("pointerdown", () => {
      state.keyboard = false;
    });
    $("truck").addEventListener("animationend", (e) => e.target.classList.remove("truck-drive-out"));
    if (!mode.seconds) {
      $("timeLabel").textContent = "組數";
      $("quit").hidden = false;
    }
    renderTime();
    try {
      if (mode.ranked) {
        backend = rankedBackend(student);
      } else {
        const stores = await (await fetch("stores.json")).json();
        backend = localBackend(stores);
      }
      const s = await backend.start();
      await countdown(s.waitMs);
      if (s.remainingMs !== undefined) state.timeLeftMs = s.remainingMs;
      showRound(s.round, s.setNo);
      state.lastTick = performance.now();
      state.timerOn = true;
      state.timer = setInterval(tick, 200);
    } catch (err) {
      if (err.message === "no-deck") location.replace("index.html");
      else failAndLeave(err);
    }
  }

  window.__game = state; // 方便除錯與自動化測試
  boot();
})();
