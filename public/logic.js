// 出題、判定、計分與解說。不碰畫面，瀏覽器與 Cloudflare Worker 共用同一份。
(function (root) {
  const SPECIAL_MUNIS = new Set(["臺北市", "新北市", "桃園市", "臺中市", "臺南市", "高雄市"]);
  const PROVINCIAL_CITIES = new Set(["基隆市", "新竹市", "嘉義市"]);
  const CITY_OPTIONS = ["直轄市", "縣", "省轄市"];
  const DIST_OPTIONS = ["鄉", "鎮", "市", "區"];

  // 權重直接作用在「縣市」，門市數量不再影響機率；省轄市與離島刻意提高。
  const CITY_WEIGHTS = { "基隆市": 1.5, "新竹市": 1.5, "嘉義市": 1.5, "連江縣": 1.3, "澎湖縣": 1.3, "金門縣": 1.3 };

  const MODES = {
    standard: { label: "校內競賽", seconds: 180, ranked: true },
    challenge: { label: "限時衝刺", seconds: 120, wrongPenalty: 5 },
    practice: { label: "練習模式", sets: 10 },
    review: { label: "錯題練習" },
  };

  // 答對換題快、答錯稍慢，時間差就是答錯的代價
  const PAUSE_MS = { correct: 450, wrong: 900 };

  const trimSuffix = (t) => (t && "縣市鄉鎮區".includes(t.slice(-1)) ? t.slice(0, -1) : t || "");

  function classifyCityType(name) {
    if (SPECIAL_MUNIS.has(name)) return "直轄市";
    if (PROVINCIAL_CITIES.has(name)) return "省轄市";
    return name.endsWith("縣") ? "縣" : "未知";
  }

  function classifyDistrictType(name) {
    const last = name.slice(-1);
    return "鄉鎮市區".includes(last) ? last : "未知";
  }

  // 鄉鎮市區按鈕的「市」顯示為「縣轄市」，內部值維持單字。
  const districtLabel = (v) => (v === "市" ? "縣轄市" : v);

  function explainCity(rec) {
    const c = rec.縣市;
    const type = classifyCityType(c);
    if (type === "直轄市") return `${c}是六都之一，屬於直轄市。`;
    if (type === "省轄市") return `${c}是與縣同級的省轄市。`;
    return `${c}的層級就是「縣」。`;
  }

  function explainDistrict(rec) {
    const c = rec.縣市;
    const d = rec.鄉鎮市區;
    const type = classifyDistrictType(d);
    if (type === "區") return `${c}是${classifyCityType(c)}，底下都是「區」，所以${d}是區。`;
    if (type === "市") return `${d}在${c}底下，是縣轄市；縣的下一層沒有「區」。`;
    return `${d}在${c}底下，層級是「${type}」。`;
  }

  // 送到畫面的包裹：只給去掉字尾的地名，完整名稱等作答後才揭曉
  function toPackage(rec) {
    return {
      name: rec.門市名稱,
      address: rec.其餘地址,
      cityLabel: trimSuffix(rec.縣市),
      distLabel: trimSuffix(rec.鄉鎮市區),
    };
  }

  // 每格 5 分，兩件全對 +10，連對第二組起每組再多 2 分，最多 +10。
  function scoreRound(okCount, streakAfter) {
    const allCorrect = okCount === 4;
    const combo = allCorrect ? Math.min(Math.max(streakAfter - 1, 0), 5) * 2 : 0;
    return okCount * 5 + (allCorrect ? 10 : 0) + combo;
  }

  // 判定一組兩件包裹。picks = [{ city, dist }, { city, dist }]
  function judgeRound(recs, picks, streakBefore) {
    let okCount = 0;
    const results = recs.map((rec, i) => {
      const city = classifyCityType(rec.縣市);
      const dist = classifyDistrictType(rec.鄉鎮市區);
      const cityOk = picks[i].city === city;
      const distOk = picks[i].dist === dist;
      okCount += cityOk + distOk;
      return { city, dist, cityOk, distOk, fullCity: rec.縣市, fullDist: rec.鄉鎮市區 };
    });
    const allCorrect = okCount === 4;
    const streak = allCorrect ? streakBefore + 1 : 0;
    return { results, okCount, allCorrect, streak, gained: scoreRound(okCount, streak) };
  }

  // 結局「查看解答」的一筆資料
  function reviewItem(rec, pick) {
    const city = classifyCityType(rec.縣市);
    const dist = classifyDistrictType(rec.鄉鎮市區);
    const picks = [];
    const why = [];
    if (pick.city !== city) {
      picks.push(`你選「${pick.city}」，正解是「${city}」`);
      why.push(explainCity(rec));
    }
    if (pick.dist !== dist) {
      picks.push(`你選「${districtLabel(pick.dist)}」，正解是「${districtLabel(dist)}」`);
      why.push(explainDistrict(rec));
    }
    return { rec, place: rec.縣市 + rec.鄉鎮市區, picks, why: why.join("") };
  }

  function pickEnding(result) {
    const mode = MODES[result.mode] || MODES.standard;
    if (!mode.seconds) {
      const rate = result.items ? result.correct / result.items : 0;
      if (rate >= 0.95) return "end1";
      if (rate >= 0.85) return "end2";
      if (rate >= 0.7) return "end3";
      if (rate >= 0.5) return "end4";
      return "end5";
    }
    const s = (result.score * 180) / mode.seconds; // 換算成 3 分鐘基準
    if (s >= 720) return "end1";
    if (s >= 500) return "end2";
    if (s >= 340) return "end3";
    if (s >= 200) return "end4";
    return "end5";
  }

  // 依「縣市 → 鄉鎮市區 → 門市」三層抽題，並避開最近出現過的鄉鎮市區。
  function createPicker(data, rng = Math.random) {
    const tree = new Map();
    for (const rec of data) {
      if (!tree.has(rec.縣市)) tree.set(rec.縣市, new Map());
      const dists = tree.get(rec.縣市);
      if (!dists.has(rec.鄉鎮市區)) dists.set(rec.鄉鎮市區, []);
      dists.get(rec.鄉鎮市區).push(rec);
    }
    const cities = [...tree.keys()];
    const weights = cities.map((c) => CITY_WEIGHTS[c] || 1);
    const total = weights.reduce((a, b) => a + b, 0);
    const recent = [];
    const anyOf = (arr) => arr[Math.floor(rng() * arr.length)];

    function pickCity() {
      let r = rng() * total;
      for (let i = 0; i < cities.length; i++) {
        r -= weights[i];
        if (r <= 0) return cities[i];
      }
      return cities[cities.length - 1];
    }

    return function pick() {
      for (let tries = 0; ; tries++) {
        const city = pickCity();
        const dist = anyOf([...tree.get(city).keys()]);
        const key = city + dist;
        if (recent.includes(key) && tries < 20) continue;
        recent.push(key);
        if (recent.length > 12) recent.shift();
        return anyOf(tree.get(city).get(dist));
      }
    };
  }

  // 抽一組不重複的兩間門市
  function pickPair(pick) {
    const a = pick();
    let b = pick();
    while (b.門市名稱 === a.門市名稱) b = pick();
    return [a, b];
  }

  const api = {
    MODES, PAUSE_MS, CITY_OPTIONS, DIST_OPTIONS, trimSuffix, classifyCityType, classifyDistrictType, districtLabel,
    explainCity, explainDistrict, toPackage, scoreRound, judgeRound, reviewItem, pickEnding, createPicker, pickPair,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GameLogic = api;
})(typeof window !== "undefined" ? window : globalThis);
