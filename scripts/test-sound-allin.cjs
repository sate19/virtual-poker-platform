const pw = require("C:/Users/22193/AppData/Roaming/npm/node_modules/playwright");

(async () => {
  const browser = await pw.chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });

  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);

  console.log("=== Testing: build allin pool first, then try other sounds ===");

  const results = await page.evaluate(async () => {
    const L = [];

    // PART 1: Build allin pool (4 elements x 14MB each)
    L.push("1) Building allin pool (4 elements, preload=auto)...");
    const allinPool = [];
    for (let i = 0; i < 4; i++) {
      const a = new Audio("/sounds/allin/allin.mp3");
      a.preload = "auto";
      allinPool.push(a);
      L.push(`   allin[${i}]: networkState=${a.networkState}`);
    }

    // Give a moment for preload to start
    await new Promise(r => setTimeout(r, 500));

    // Check states
    L.push("\n2) Pool states after 500ms:");
    for (let i = 0; i < 4; i++) {
      const a = allinPool[i];
      L.push(`   allin[${i}]: networkState=${a.networkState}, readyState=${a.readyState}, paused=${a.paused}, error=${a.error?.code ?? 'none'}`);
    }

    // Play one allin
    L.push("\n3) Playing one allin...");
    const playResult = allinPool[0].play().then(() => "OK", (e) => `FAIL:${e.name}`);
    L.push(`   Result: ${await playResult}`);

    await new Promise(r => setTimeout(r, 2000));

    // PART 2: Now try to build and play other sounds
    L.push("\n4) Building OTHER sound pools after allin is playing...");
    const otherSounds = ["fold", "call", "bet", "raise", "turn"];
    const otherResults = [];

    for (const name of otherSounds) {
      const pool = [];
      for (let i = 0; i < 4; i++) {
        const a = new Audio(`/sounds/${name}/${name}.mp3`);
        a.preload = "auto";
        pool.push(a);
      }
      await new Promise(r => setTimeout(r, 100));

      // Check state
      const states = pool.map(a => `ns:${a.networkState},rs:${a.readyState}`);
      L.push(`   ${name} pool: ${states.join(" | ")}`);

      // Try to play one
      try {
        const r = await pool[0].play();
        otherResults.push(`${name}: OK`);
      } catch (e) {
        otherResults.push(`${name}: ${e.name}`);
        L.push(`     ERROR playing ${name}: ${e.name} - ${e.message}`);
      }
    }

    L.push("\n5) Other sounds play results:");
    otherResults.forEach(r => L.push(`   ${r}`));

    // Check if allin is still playing
    L.push(`\n6) allin[0] state: paused=${allinPool[0].paused}, ended=${allinPool[0].ended}, currentTime=${allinPool[0].currentTime.toFixed(1)}`);

    return L.join("\n");
  });

  console.log(results);

  console.log("\nPage errors:", errors.length);
  errors.forEach(e => console.log("  -", e.substring(0, 150)));

  console.log("\nClose browser to finish...");
  await page.waitForTimeout(5000);
  await browser.close();
})();
