#!/usr/bin/env node
/**
 * Capture the documented UI states from the seeded demo workspace.
 * Requires a running app at APP_URL (default http://localhost:3000) with
 * SEED_DEMO=true. Output: docs/screenshots/*.png
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const outDir = path.join(process.cwd(), "docs", "screenshots");
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  locale: "en-US",
});
const page = await context.newPage();
page.setDefaultTimeout(20_000);

async function shot(name, locator) {
  await page.waitForTimeout(350);
  if (locator) await locator.screenshot({ path: path.join(outDir, name), animations: "disabled" });
  else await page.screenshot({ path: path.join(outDir, name), fullPage: false, animations: "disabled" });
  console.log(`captured docs/screenshots/${name}`);
}

async function signIn() {
  await page.goto(`${base}/auth?mode=signin`, { waitUntil: "domcontentloaded" });
  const heading = page.getByRole("heading", { name: "Welcome back" });
  if (await heading.isVisible().catch(() => false)) {
    await page.getByLabel("Email").fill("demo@drift.local");
    await page.locator('input[type="password"]').fill("DriftDemo123!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await page.getByRole("heading", { name: /Good (morning|afternoon|evening)|Still up/ }).waitFor({ timeout: 30_000 });
}

try {
  await signIn();
  await shot("01-today.png");

  await page.locator('nav[aria-label="Boards"]').getByRole("button", { name: /Launch runway/ }).click();
  await page.getByRole("heading", { level: 1, name: "Launch runway" }).waitFor();
  await shot("02-board.png");

  await page.locator(".task-card").first().click();
  await page.getByRole("dialog").waitFor();
  await page.getByLabel("Task description").waitFor();
  await shot("03-task-drawer.png");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);

  await page.locator('nav[aria-label="Views"]').getByRole("button", { name: /Calendar/ }).click();
  await page.getByRole("heading", { level: 1, name: "Calendar" }).waitFor();
  await shot("04-calendar.png");

  await page.getByRole("button", { name: /Insights/ }).click();
  await page.getByRole("heading", { level: 1, name: "Insights" }).waitFor();
  await shot("05-insights.png");

  await page.getByRole("button", { name: "Command palette" }).click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(450);
  await shot("06-command-palette.png");
  await page.keyboard.press("Escape");

  await page.goto(`${base}/settings#notifications`);
  await page.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
  await shot("07-settings.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page.getByRole("heading", { name: /Good (morning|afternoon|evening)|Still up/ }).waitFor();
  await shot("08-mobile-today.png");

  const authContext = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: "light", locale: "en-US" });
  const authPage = await authContext.newPage();
  await authPage.goto(`${base}/auth?mode=signin`, { waitUntil: "domcontentloaded" });
  await authPage.getByRole("heading", { name: "Welcome back" }).waitFor();
  await authPage.screenshot({ path: path.join(outDir, "09-auth.png"), animations: "disabled" });
  console.log("captured docs/screenshots/09-auth.png");
  await authContext.close();
} finally {
  await context.close();
  await browser.close();
}

const manifest = fs.readdirSync(outDir).filter((file) => file.endsWith(".png")).sort();
fs.writeFileSync(
  path.join(outDir, "README.md"),
  `# Screenshots\n\nGenerated from the seeded demo workspace (\`SEED_DEMO=true\`) at ${new Date().toISOString()} with \`npm run screenshots\`.\n\n${manifest.map((file) => `- \`${file}\` — ${file.replace(/^\d+-/, "").replace(".png", "").replaceAll("-", " ")}.`).join("\n")}\n\nScreenshots are deterministic fixtures, not customer data.\n`,
);
console.log(`\n${manifest.length} screenshots in ${path.relative(process.cwd(), outDir)}`);
