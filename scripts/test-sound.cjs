const pw = require("C:/Users/22193/AppData/Roaming/npm/node_modules/playwright");

(async () => {
  // Use headed Chrome for accurate audio testing
  const browser = await pw.chromium.launch({
    headless: false,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", err => errors.push(err.message));

  console.log("[1] Loading app context...");
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // Pre-warm audio by doing a user gesture (click somewhere)
  await page.click("body");
  await page.waitForTimeout(500);

  console.log("[2] Running audio pool test in headed Chrome...");

  const results = await page.evaluate(async () => {
    const L = [];
    function log(m) { L.push(m); console.log("[test]", m); }

    const ACTIONS = ["fold", "call", "bet", "raise", "allin", "turn"];

    // === NEW Pool approach ===
    log("=== Audio Pool Test (paused || ended) ===");
    const POOL_SIZES = { fold: 4, call: 4, bet: 4, raise: 4, allin: 3, turn: 2 };
    const poolMap = new Map();
    const cursorMap = new Map();

    function ensurePool(action) {
      let pool = poolMap.get(action);
      if (pool) return pool;
      const size = POOL_SIZES[action] ?? 2;
      pool = [];
      for (let i = 0; i < size; i++) {
        const a = new Audio(`/sounds/${action}/${action}.mp3`);
        a.preload = "auto";
        pool.push(a);
      }
      poolMap.set(action, pool);
      cursorMap.set(action, 0);
      return pool;
    }

    function poolPlay(action) {
      const pool = ensurePool(action);
      let cursor = cursorMap.get(action);
      if (action === "allin") {
        for (const a of pool) {
          if (!a.paused && !a.ended) { a.pause(); a.currentTime = 0; }
        }
      }
      let audio = null;
      for (let i = 0; i < pool.length; i++) {
        const idx = (cursor + i) % pool.length;
        const a = pool[idx];
        if (a.paused || a.ended) { audio = a; cursor = (idx + 1) % pool.length; break; }
      }
      if (!audio) {
        // Debug: check states of all elements for this action
        const states = pool.map(a => `p:${a.paused},e:${a.ended},d:${a.duration.toFixed(1)},ct:${a.currentTime.toFixed(1)}`).join(" | ");
        return `skipped [${states}]`;
      }
      cursorMap.set(action, cursor);
      audio.currentTime = 0;
      return audio.play().then(() => "played", (err) => `error:${err.name}`);
    }

    // Round 1: Build pool and play 50 sounds
    log("Round 1: 50 sounds (initial pool fill)");
    let [p1, s1, e1] = [0, 0, 0];
    const debugs = [];
    for (let i = 0; i < 50; i++) {
      const r = await poolPlay(ACTIONS[i % ACTIONS.length]);
      if (r === "played") p1++;
      else if (typeof r === "string" && r.startsWith("skipped")) { s1++; if (debugs.length < 3) debugs.push(r); }
      else e1++;
    }
    log(`  Played: ${p1}, Skipped: ${s1}, Errors: ${e1}`);
    if (debugs.length) debugs.forEach(d => log(`  Debug: ${d}`));

    // Wait for sounds to finish
    log("Waiting 2s for sounds to finish...");
    await new Promise(r => setTimeout(r, 2000));

    // Round 2: All should be available now
    log("Round 2: 30 sounds (pool reuse after wait)");
    let [p2, s2, e2] = [0, 0, 0];
    for (let i = 0; i < 30; i++) {
      const r = await poolPlay(ACTIONS[i % ACTIONS.length]);
      if (r === "played") p2++;
      else if (typeof r === "string" && r.startsWith("skipped")) s2++;
      else e2++;
    }
    log(`  Played: ${p2}, Skipped: ${s2}, Errors: ${e2}`);

    // Round 3: 100 rapid sounds
    log("Round 3: 100 rapid sounds (stress test)");
    let [p3, s3, e3] = [0, 0, 0];
    const debugs3 = [];
    for (let i = 0; i < 100; i++) {
      const r = await poolPlay(ACTIONS[i % ACTIONS.length]);
      if (r === "played") p3++;
      else if (typeof r === "string" && r.startsWith("skipped")) { s3++; if (debugs3.length < 3) debugs3.push(r); }
      else e3++;
    }
    log(`  Played: ${p3}, Skipped: ${s3}, Errors: ${e3}`);
    if (debugs3.length) debugs3.forEach(d => log(`  Debug: ${d}`));

    await new Promise(r => setTimeout(r, 2000));

    // Round 4: Reuse after wait
    log("Round 4: 30 sounds after 2s wait");
    let [p4, s4, e4] = [0, 0, 0];
    for (let i = 0; i < 30; i++) {
      const r = await poolPlay(ACTIONS[i % ACTIONS.length]);
      if (r === "played") p4++; else if (typeof r === "string" && r.startsWith("skipped")) s4++; else e4++;
    }
    log(`  Played: ${p4}, Skipped: ${s4}, Errors: ${e4}`);

    const totalErrors = e1 + e2 + e3 + e4;
    const totalPlayed = p1 + p2 + p3 + p4;
    log(`\nTotal: ${totalPlayed} played, ${totalErrors} errors`);

    // Also check pool state
    let totalEl = 0;
    for (const [, pool] of poolMap) totalEl += pool.length;
    log(`Pool elements: ${totalEl}  |  Old approach would have created ${totalPlayed} separate Audio objects`);

    const verdict = (totalErrors === 0) ? "PASS" : "ISSUE";
    log(`Verdict: ${verdict}`);

    return { log: L.join("\n"), verdict };
  });

  console.log("\n" + results.log);

  const audioErrs = errors.filter(e => /audio|sound|play|Audio/i.test(e));
  console.log(`\nPage console audio errors: ${audioErrs.length}`);
  audioErrs.forEach(e => console.log("  -", e.substring(0, 150)));

  console.log("\nClose the browser window to finish, or wait 5s...");
  await page.waitForTimeout(5000);
  await browser.close();
  console.log("Done.");
})();
