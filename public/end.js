(function () {
  const L = window.GameLogic;
  const $ = (id) => document.getElementById(id);
  const result = JSON.parse(sessionStorage.getItem("last-result") || "null");
  if (!result) {
    location.replace("index.html");
    return;
  }

  const RANK = { end1: "業界傳說", end2: "王牌宅配員", end3: "勉強過關", end4: "待加強的新人", end5: "收到解僱通知" };
  const TEXT = {
    end1: "每趟包裹都送得又快又準，只要有門牌的地方，\n就能看到你專業的身影——你已成為業界的傳說！",
    end2: "大多數包裹都能順利送達，距離完美只差一步，\n你的表現相當亮眼，獲得老闆和客戶們一致肯定！",
    end3: "貨雖然送到了，但速度總是慢半拍，\n這樣的表現只能算勉強過關，或許再熟悉一陣子就會更上手！",
    end4: "送貨的狀況不是很理想，接二連三的錯誤，\n讓公司評價一路下滑，這樣下去可能要領不到薪水了！",
    end5: "你的包裹總是送錯地方，客戶的投訴層出不窮。\n表現完全不合格，公司二話不說就決定把你開除！",
  };

  // ====== 結局演出 ======
  const ending = L.pickEnding(result);
  $("endArt").src = `picture/${ending}.webp`;
  typewriter($("story"), TEXT[ending], 60, () => {
    $("prompt").hidden = false;
  });

  // ====== 成績視窗 ======
  const mode = L.MODES[result.mode];
  $("rank").textContent = RANK[ending];
  $("statScore").textContent = result.score;
  $("statRate").textContent = `${Math.round((result.correct / result.items) * 100)}%`;
  $("statSets").textContent = result.sets;
  $("statStreak").textContent = result.bestStreak;
  $("again").href = `game.html?mode=${result.mode === "review" ? "practice" : result.mode}`;

  function noteText() {
    if (mode.ranked) {
      if (result.isTest) return "測試帳號不列入榮譽榜";
      const parts = [];
      if (result.rank) parts.push(`目前全校第 ${result.rank} 名`);
      parts.push(result.isNewRecord ? "刷新個人最佳！" : `個人最佳 ${result.bestScore} 分`);
      return parts.join("・");
    }
    if (mode.seconds) {
      const key = `best-${result.mode}`;
      const best = Store.get(key, 0);
      if (result.score > best) Store.set(key, result.score);
      return result.score > best ? "刷新個人最佳！" : `個人最佳 ${best} 分`;
    }
    return mode.label;
  }
  $("note").textContent = noteText();

  // ====== 解答 ======
  const review = result.review || [];
  if (review.length) {
    $("reviewBtn").hidden = false;
    const seen = new Map();
    for (const item of review) seen.set(item.rec.門市名稱, item);
    Store.set("review-deck", [...seen.values()].map((item) => item.rec));
    const el = (tag, cls, text) => {
      const node = document.createElement(tag);
      node.className = cls;
      node.textContent = text;
      return node;
    };
    for (const item of seen.values()) {
      const box = el("section", "answer-item", "");
      box.append(el("h3", "answer-place", item.place));
      item.picks.forEach((p) => box.append(el("p", "answer-pick", p)));
      box.append(el("p", "answer-why", item.why));
      $("reviewList").append(box);
    }
  }
  $("reviewBtn").addEventListener("click", () => $("reviewDialog").showModal());
  $("reviewClose").addEventListener("click", () => $("reviewDialog").close());

  // ====== 榮譽榜 ======
  if (mode.ranked) {
    $("boardBtn").hidden = false;
    const openBoard = setupBoard();
    $("boardBtn").addEventListener("click", openBoard);
  } else {
    $("boardClose").addEventListener("click", () => $("boardDialog").close());
  }

  // ====== 點擊開啟成績 ======
  const OPEN_GUARD_MS = 600; // 遊戲結束時還在連點，不要立刻跳過結局
  const openedAt = performance.now();
  const dialog = $("scoreDialog");
  const anyOpen = () => document.querySelector("dialog[open]");
  const openScore = () => {
    if (!anyOpen() && performance.now() - openedAt > OPEN_GUARD_MS) dialog.showModal();
  };
  document.addEventListener("click", (e) => {
    if (!e.target.closest("dialog")) openScore();
  });
  window.addEventListener("keydown", (e) => {
    if (!anyOpen() && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      openScore();
    }
  });
  $("scoreClose").addEventListener("click", () => dialog.close());
})();
