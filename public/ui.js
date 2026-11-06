// 三個頁面共用的小工具。
const Store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 無痕模式等情況存不了，遊戲仍可進行 */
    }
  },
};

// 呼叫後端 API。伺服器回應的錯誤帶 status；連線失敗則沒有。
async function api(path, body) {
  const init = body === undefined
    ? {}
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error("連不上伺服器，請確認網路");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `發生錯誤（${res.status}）`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

// 把榮譽榜畫進 <dialog id="boardDialog">，首頁與結局頁共用
function setupBoard() {
  const dialog = document.getElementById("boardDialog");
  const select = document.getElementById("boardClass");
  const list = document.getElementById("boardList");
  const note = document.getElementById("boardNote");

  async function load() {
    list.replaceChildren();
    note.textContent = "載入中…";
    try {
      const data = await api(`/api/leaderboard${select.value ? `?class=${encodeURIComponent(select.value)}` : ""}`);
      const current = select.value;
      select.replaceChildren(new Option("全部班級", ""), ...data.classes.map((c) => new Option(c, c)));
      select.value = data.classes.includes(current) ? current : "";
      note.textContent = data.entries.length ? "" : "還沒有人上榜，快來搶第一！";
      for (const e of data.entries) {
        const li = document.createElement("li");
        const rank = document.createElement("span");
        const who = document.createElement("span");
        const score = document.createElement("b");
        rank.className = "board-rank";
        rank.textContent = e.rank;
        who.className = "board-who";
        who.textContent = `${e.className} ${e.name}`;
        score.textContent = e.bestScore.toLocaleString();
        li.append(rank, who, score);
        list.append(li);
      }
    } catch (err) {
      note.textContent = err.message;
    }
  }

  select.addEventListener("change", load);
  document.getElementById("boardClose").addEventListener("click", () => dialog.close());
  return function open() {
    dialog.showModal();
    load();
  };
}

// 搭配 CSS 的 word-break: keep-all，讓中文只在標點後換行；窄螢幕改由瀏覽器決定行數。
function formatStory(text) {
  const narrow = matchMedia("(max-width: 759px)").matches;
  return (narrow ? text.replace(/\n/g, "") : text)
    .replace(/——/g, "⁠——") // 破折號不可落在行首
    .replace(/[，。！]|——/g, "$&​");
}

function typewriter(el, rawText, speed = 40, done = () => {}) {
  const text = formatStory(rawText);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = text;
    done();
    return;
  }
  let i = 0;
  el.textContent = "";
  el.classList.add("typewriter-cursor");
  (function step() {
    if (i < text.length) {
      el.textContent += text[i++];
      setTimeout(step, speed);
    } else {
      el.classList.remove("typewriter-cursor");
      done();
    }
  })();
}
