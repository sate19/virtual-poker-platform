const pw = require("C:/Users/22193/AppData/Roaming/npm/node_modules/playwright");

(async () => {
  const browser = await pw.chromium.launch({ headless: false, args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  const soundLogs = [];
  const allConsole = [];
  page.on("console", msg => {
    allConsole.push(`[${msg.type()}] ${msg.text()}`);
    if (msg.text().includes("[sound-pool]")) {
      soundLogs.push(msg.text());
      console.log("  SOUND:", msg.text());
    }
  });
  page.on("pageerror", err => console.log("  PAGE ERROR:", err.message));

  // Login
  console.log("[1] Login...");
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "Player12345!" }),
    });
  });
  await page.waitForTimeout(500);

  // Go to room
  console.log("[2] Entering room (looking for sound-pool logs)...");
  try {
    await page.goto("http://localhost:3000/table/cmq59ritk0001gdigflq6w231", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
  } catch (e) {
    console.log("  Load error:", e.message.substring(0, 100));
  }
  await page.waitForTimeout(5000);

  // Show all sound-pool logs collected
  console.log("\n[3] Sound pool logs collected:");
  if (soundLogs.length === 0) {
    console.log("  NONE! The sound module may not have loaded.");
  } else {
    soundLogs.forEach(l => console.log(" ", l));
  }

  // Try to interact
  console.log("\n[4] Trying actions...");
  const checkBtn = page.locator('button:has-text("过牌")').first();
  const foldBtn = page.locator('button:has-text("弃牌")').first();

  if (await checkBtn.isEnabled({ timeout: 1000 }).catch(() => false)) {
    await checkBtn.click();
    console.log("  Clicked Check");
  } else if (await foldBtn.isEnabled({ timeout: 1000 }).catch(() => false)) {
    await foldBtn.click();
    console.log("  Clicked Fold");
  } else {
    console.log("  No action available (not our turn or disabled)");
  }
  await page.waitForTimeout(3000);

  // Show new sound logs after interaction
  console.log("\n[5] New sound logs after interaction:");
  const newLogs = soundLogs.slice();
  if (newLogs.length === 0) console.log("  None");

  // Show all console messages (limited)
  console.log("\n[6] All page errors:");
  const errors = allConsole.filter(m => m.includes("[error]") || m.includes("[PAGE_ERROR]"));
  errors.slice(0, 10).forEach(e => console.log(" ", e.substring(0, 250)));

  console.log("\nClose browser window to finish...");
  await page.waitForTimeout(15000);
  await browser.close();
})();
