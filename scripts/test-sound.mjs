import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const audioErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") {
    audioErrors.push(msg.text());
  }
});
page.on("pageerror", (err) => audioErrors.push(err.message));

// 1. Navigate to login page
console.log("[1] Navigating to login...");
await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
await page.waitForTimeout(1000);

// 2. Login as alice
console.log("[2] Logging in as alice...");
const usernameInput = page.locator('input[name="username"]').first();
const passwordInput = page.locator('input[type="password"]').first();
if (await usernameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
  await usernameInput.fill("alice");
  await passwordInput.fill("Player12345!");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(2000);
  console.log("    Logged in. URL:", page.url());
} else {
  console.log("    Login form not found, trying API login...");
  await page.evaluate(async () => {
    await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "Player12345!" }),
    });
  });
  await page.waitForTimeout(1000);
}

// 3. Navigate to room
console.log("[3] Entering room...");
await page.goto("http://localhost:3000/table/cmq59ritk0001gdigflq6w231", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);

// 4. Check if seated, if not try to sit
const sitBtn = page.locator('button:has-text("坐下")').first();
if (await sitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
  await sitBtn.click();
  await page.waitForTimeout(1000);
  console.log("[4] Sat down.");
}

// 5. Ready up
const readyBtn = page.locator('button:has-text("准备")').first();
if (await readyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
  await readyBtn.click();
  await page.waitForTimeout(500);
  console.log("[5] Readied up.");
}

// 6. Simulate many actions — play action buttons whenever visible
console.log("[6] Playing actions for multiple rounds...");
for (let round = 0; round < 30; round++) {
  await page.waitForTimeout(2000);

  const checkBtn = page.locator('button:has-text("过牌")').first();
  const callBtn = page.locator('button:has-text("跟注")').first();
  const foldBtn = page.locator('button:has-text("弃牌")').first();
  const betBtn = page.locator('button:has-text("加注")').first();
  const raiseBtn = page.locator('button:has-text("加注")').first();

  if (await checkBtn.isVisible().catch(() => false)) {
    console.log(`[6.${round}] Check`);
    await checkBtn.click();
  } else if (await callBtn.isVisible().catch(() => false)) {
    console.log(`[6.${round}] Call`);
    await callBtn.click();
  } else if (await foldBtn.isVisible().catch(() => false)) {
    console.log(`[6.${round}] Fold`);
    await foldBtn.click();
  } else if (await betBtn.isVisible().catch(() => false)) {
    console.log(`[6.${round}] Bet`);
    await betBtn.click();
  } else {
    console.log(`[6.${round}] Waiting... (not my turn)`);
  }
}

// 7. Report
console.log("\n=== RESULTS ===");
console.log(`Total console errors: ${audioErrors.length}`);
const audioRelated = audioErrors.filter(e => e.toLowerCase().includes("audio"));
console.log(`Audio-related errors: ${audioRelated.length}`);
if (audioRelated.length > 0) {
  console.log("Audio errors:");
  audioRelated.forEach((e) => console.log(`  - ${e.substring(0, 120)}`));
}

// Also report non-audio errors for context
const otherErrors = audioErrors.filter(e => !e.toLowerCase().includes("audio"));
console.log(`Other console errors: ${otherErrors.length}`);
if (otherErrors.length > 0) {
  otherErrors.slice(0, 5).forEach((e) => console.log(`  - ${e.substring(0, 120)}`));
}

console.log(`\nFinal page URL: ${page.url()}`);

await browser.close();
console.log("\nDone.");
