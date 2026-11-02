/*
 * Cross-application parity audit for Project3383 against ProjectA2.
 *
 * Usage (from the repository root):
 *   $env:NODE_PATH="C:\path\to\ProjectA2\node_modules"
 *   node scripts/parity-audit.cjs
 *
 * Optional environment variables:
 *   REF_BASE      default http://localhost:3000
 *   APP_BASE      default http://localhost:3383
 *   DRIFT_EMAIL   default demo@drift.local
 *   DRIFT_PASS    default DriftDemo123!
 *   AUDIT_DIR     default target/parity-audit
 *
 * The script fails with a non-zero exit code on any discovered mismatch.
 * It only reads the reference application. Temporary boards are created and
 * deleted in Project3383 for transition tests.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const REF_BASE = process.env.REF_BASE || "http://localhost:3000";
const APP_BASE = process.env.APP_BASE || "http://localhost:3383";
const EMAIL = process.env.DRIFT_EMAIL || "demo@drift.local";
const PASSWORD = process.env.DRIFT_PASS || "DriftDemo123!";
const OUT = path.resolve(ROOT, process.env.AUDIT_DIR || "target/parity-audit");
fs.mkdirSync(OUT, { recursive: true });

const failures = [];
const warnings = [];
const stats = {};

function fail(area, message, detail) {
  failures.push({ area, message, detail });
}

function warn(area, message, detail) {
  warnings.push({ area, message, detail });
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

async function login(page, base) {
  await page.goto(base + "/auth", { waitUntil: "networkidle" });
  await page.evaluate(
    async ({ email, password }) => {
      const response = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) throw new Error("signin " + response.status);
    },
    { email: EMAIL, password: PASSWORD },
  );
}

async function gotoView(page, base, view) {
  await page.goto(base + "/?view=" + view, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
}

async function bodyAudit(page, view, base, allowOverflow = false) {
  const data = await page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden";
    };
    const label = (element) =>
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      element.getAttribute("placeholder") ||
      (element.labels && [...element.labels].map((item) => item.innerText).join(" ")) ||
      element.innerText ||
      "";
    const controls = [...document.querySelectorAll("button,a[href],input,select,textarea")].filter(visible);
    const unnamed = controls
      .filter((element) => !String(label(element)).replace(/\s+/g, " ").trim())
      .map((element) => ({
        tag: element.tagName,
        id: element.id,
        cls: String(element.className || "").slice(0, 80),
        outer: element.outerHTML.slice(0, 220),
      }));
    const text = document.body.innerText;
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      unnamed,
      issues: ["undefined", "NaN", "{{", "\uFFFD"].filter((value) => text.includes(value)),
      controls: controls.length,
    };
  });
  if (data.overflow > 0 && !allowOverflow) fail("layout", `${base} ${view}: horizontal overflow ${data.overflow}px`);
  if (data.unnamed.length) fail("a11y", `${base} ${view}: ${data.unnamed.length} visible controls without a name`, data.unnamed);
  if (data.issues.length) fail("content", `${base} ${view}: found ${data.issues.join(", ")}`);
  return data;
}

async function style(page, selector, props, textSelector = null) {
  return page.evaluate(
    ({ selector, props, textSelector }) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const title = textSelector ? document.querySelector(textSelector) : element;
      if (!title) return null;
      const style = getComputedStyle(title);
      const result = {};
      for (const prop of props) result[prop] = style[prop];
      const rect = element.getBoundingClientRect();
      result._rect = { width: rect.width, height: rect.height, top: rect.top, left: rect.left };
      return result;
    },
    { selector, props, textSelector },
  );
}

function compareValues(area, label, reference, app, props, tolerances = {}) {
  if (!reference && !app) return;
  if (!reference || !app) {
    fail(area, `${label}: selector missing`, { reference: Boolean(reference), app: Boolean(app) });
    return;
  }
  for (const prop of props) {
    const expected = reference[prop];
    const actual = app[prop];
    if (expected === actual) continue;
    const tolerance = tolerances[prop] == null ? 0 : tolerances[prop];
    if (typeof expected === "number" && typeof actual === "number" && Math.abs(expected - actual) <= tolerance) continue;
    fail(area, `${label}: ${prop} differs`, { reference: expected, app: actual });
  }
}

async function cardSnapshots(page, cardSelector, titleSelector) {
  return page.evaluate(
    ({ cardSelector, titleSelector }) => {
      return [...document.querySelectorAll(cardSelector)].map((card) => {
        const title = card.querySelector(titleSelector);
        const top = card.querySelector(".task-topline,.card-top-meta");
        const foot = card.querySelector(".task-foot,.card-foot");
        const desc = card.querySelector(".task-desc,.card-description");
        const titleStyle = getComputedStyle(title);
        const topStyle = top ? getComputedStyle(top) : null;
        const footStyle = foot ? getComputedStyle(foot) : null;
        const descStyle = desc ? getComputedStyle(desc) : null;
        const rect = card.getBoundingClientRect();
        return {
          title: title.textContent.replace(/\s+/g, " ").trim(),
          completed: card.classList.contains("completed"),
          height: Math.round(rect.height * 100) / 100,
          color: titleStyle.color,
          decoration: titleStyle.textDecorationLine,
          fontSize: titleStyle.fontSize,
          fontWeight: titleStyle.fontWeight,
          lineHeight: titleStyle.lineHeight,
          topOpacity: topStyle ? topStyle.opacity : null,
          footMarginTop: footStyle ? footStyle.marginTop : null,
          descMarginTop: descStyle ? descStyle.marginTop : null,
        };
      });
    },
    { cardSelector, titleSelector },
  );
}

async function compareCardSets(refPage, appPage) {
  const reference = await cardSnapshots(refPage, ".task-card", ".task-title");
  const app = await cardSnapshots(appPage, ".card", "h3");
  stats.referenceCards = reference.length;
  stats.appCards = app.length;
  const byTitle = new Map(app.map((card) => [card.title, card]));
  let matched = 0;
  for (const expected of reference) {
    const actual = byTitle.get(expected.title);
    if (!actual) {
      warn("cards", `No matching app card for reference task "${expected.title}"`);
      continue;
    }
    matched++;
    if (expected.completed !== actual.completed) {
      fail("cards", `"${expected.title}": completion state differs`, { reference: expected.completed, app: actual.completed });
    }
    if (Math.abs(expected.height - actual.height) > 2) {
      fail("cards", `"${expected.title}": card height differs`, { reference: expected.height, app: actual.height });
    }
    for (const prop of ["color", "decoration", "fontSize", "fontWeight", "lineHeight", "topOpacity", "footMarginTop", "descMarginTop"]) {
      if (expected[prop] !== actual[prop]) {
        fail("cards", `"${expected.title}": ${prop} differs`, { reference: expected[prop], app: actual[prop] });
      }
    }
  }
  stats.matchedCards = matched;
}

async function listViewSnapshot(page, selector) {
  return page.evaluate((selector) => {
    return [...document.querySelectorAll(selector)].map((row) => {
      const title = row.querySelector(".row-title strong,.row-title > span:first-child");
      const status = row.querySelector(".row-status,.row-col-status");
      const style = getComputedStyle(row);
      const titleStyle = title ? getComputedStyle(title) : null;
      const rect = row.getBoundingClientRect();
      return {
        title: title ? title.textContent.replace(/\s+/g, " ").trim() : "",
        height: Math.round(rect.height * 100) / 100,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        fontSize: style.fontSize,
        color: style.color,
        titleColor: titleStyle ? titleStyle.color : null,
        statusColor: status ? getComputedStyle(status).color : null,
      };
    });
  }, selector);
}

async function compareListView(refPage, appPage) {
  const clickList = async (page, app) => {
    if (app) {
      await page.click("#listViewButton");
    } else {
      await page.evaluate(() => {
        const button = [...document.querySelectorAll("button")].find((item) =>
          /^(List|\u6E05\u55AE)$/.test(item.innerText.trim()),
        );
        if (button) button.click();
      });
    }
    await page.waitForTimeout(350);
  };
  await clickList(refPage, false);
  await clickList(appPage, true);
  const reference = await listViewSnapshot(refPage, "button.list-row");
  const app = await listViewSnapshot(appPage, ".board-list-row:not(.board-list-head)");
  stats.referenceListRows = reference.length;
  stats.appListRows = app.length;
  const byTitle = new Map(app.map((row) => [row.title, row]));
  let matched = 0;
  for (const expected of reference) {
    const actual = byTitle.get(expected.title);
    if (!actual) continue;
    matched++;
    if (Math.abs(expected.height - actual.height) > 2) {
      fail("list", `"${expected.title}": row height differs`, { reference: expected.height, app: actual.height });
    }
    for (const prop of ["paddingLeft", "paddingRight", "fontSize", "color", "titleColor", "statusColor"]) {
      if (expected[prop] !== actual[prop]) {
        fail("list", `"${expected.title}": ${prop} differs`, { reference: expected[prop], app: actual[prop] });
      }
    }
  }
  stats.matchedListRows = matched;
  const clickBoard = async (page, app) => {
    if (app) {
      await page.click("#boardViewButton");
    } else {
      await page.evaluate(() => {
        const button = [...document.querySelectorAll("button")].find((item) =>
          /^(Board|\u770B\u677F)$/.test(item.innerText.trim()),
        );
        if (button) button.click();
      });
    }
    await page.waitForTimeout(300);
  };
  await clickBoard(refPage, false);
  await clickBoard(appPage, true);
}

async function overlayAudit(refPage, appPage, appBase) {
  for (const page of [refPage, appPage]) {
    await page.keyboard.press("Escape").catch(() => {});
  }
  await gotoView(refPage, REF_BASE, "board");
  await gotoView(appPage, appBase, "board");

  for (const [page, base] of [
    [refPage, REF_BASE],
    [appPage, appBase],
  ]) {
    const card = page.locator(".task-card, .card").filter({ hasText: "Call Mum" }).first();
    if (await card.count()) {
      await card.click();
      await page.waitForTimeout(450);
      if (page === appPage) {
        const visible = await page.locator("#taskModal").isVisible();
        if (!visible) fail("drawer", "task drawer did not open");
        const toggleLabel = await page.locator("#taskCompleteToggle").getAttribute("aria-label");
        if (!/Reopen/.test(toggleLabel || "")) {
          fail("drawer", "completed task drawer does not offer Reopen", { label: toggleLabel });
        }
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
    }
  }

  await appPage.keyboard.press("Control+k");
  await appPage.waitForTimeout(300);
  if (!(await appPage.locator("#paletteModal").isVisible())) fail("palette", "command palette did not open");
  await appPage.keyboard.press("Escape");
  await appPage.waitForTimeout(200);
  await appPage.locator("body").press("c");
  await appPage.waitForTimeout(300);
  if (!(await appPage.locator("#captureModal").isVisible())) fail("capture", "quick capture did not open");
  if (!(await appPage.locator("#captureAddButton").isDisabled())) {
    fail("capture", "empty quick capture Add button should be disabled");
  }
  await appPage.keyboard.press("Escape");
  await appPage.waitForTimeout(200);

  await appPage.goto(appBase + "/settings", { waitUntil: "networkidle" });
  await appPage.waitForTimeout(700);
  const settings = await appPage.evaluate(() => ({
    sections: document.querySelectorAll("#settingsSections > .settings-section").length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  if (settings.sections < 19) fail("settings", "settings sections missing", settings);
  if (settings.overflow > 0) fail("settings", "settings horizontal overflow", settings);
  await bodyAudit(appPage, "settings", "app");
}

async function onePageAudit(appPage, appBase) {
  const cases = [[1440, 1000], [1440, 900], [1366, 768], [1024, 900]];
  for (const [width, height] of cases) {
    await appPage.setViewportSize({ width, height });
    for (const view of ["upcoming", "archive", "board", "calendar"]) {
      await gotoView(appPage, appBase, view);
      const overflow = await appPage.evaluate(() =>
        Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
      );
      if (overflow > 1) {
        fail("layout", `${view} @ ${width}x${height}: one-page view needs ${overflow}px vertical scroll`);
      }
    }
  }
  await appPage.setViewportSize({ width: 1440, height: 1000 });
}

async function responsiveAudit(appPage, appBase) {
  for (const width of [390, 768, 1024, 1440]) {
    await appPage.setViewportSize({ width, height: 900 });
    for (const view of ["today", "board", "upcoming", "calendar", "search", "archive", "insights"]) {
      await gotoView(appPage, appBase, view);
      await bodyAudit(appPage, view, "app@" + width, width === 390 && view === "upcoming");
    }
    await appPage.goto(appBase + "/settings", { waitUntil: "networkidle" });
    await appPage.waitForTimeout(500);
    await bodyAudit(appPage, "settings", "app@" + width);
  }
  await appPage.setViewportSize({ width: 1440, height: 1000 });
}

async function captureAudit(appPage, appBase) {
  const entryPoints = [
    ["today", "#captureButton"],
    ["today", "#todayCaptureButton"],
    ["board", "#boardNewTaskButton"],
    ["upcoming", "#upcomingNewTaskButton"],
    ["calendar", "#calendarNewTaskButton"],
    ["insights", "#insightsNewTaskButton"],
  ];
  for (const [view, selector] of entryPoints) {
    await gotoView(appPage, appBase, view);
    await appPage.click(selector);
    await appPage.waitForTimeout(250);
    const data = await appPage.evaluate(() => {
      const input = document.querySelector("#captureInput");
      const style = getComputedStyle(input);
      return {
        visible: !document.querySelector("#captureModal").classList.contains("hidden"),
        board: document.querySelector("#captureBoard")?.value || "",
        column: document.querySelector("#captureColumn")?.value || "",
        boardCount: document.querySelector("#captureBoard")?.options.length || 0,
        columnCount: document.querySelector("#captureColumn")?.options.length || 0,
        borderWidth: parseFloat(style.borderTopWidth),
        background: style.backgroundColor,
      };
    });
    if (!data.visible) fail("capture", `${view} ${selector}: quick capture did not open`);
    if (!data.board || !data.column) fail("capture", `${view} ${selector}: default board/column missing`, data);
    if (data.borderWidth < 1) fail("capture", `${view} ${selector}: input has no visible border`, data);
    if (!data.background || data.background === "rgba(0, 0, 0, 0)") {
      fail("capture", `${view} ${selector}: input has no visible background`, data);
    }
    await appPage.keyboard.press("Escape");
    await appPage.waitForTimeout(150);
  }

  const readCapture = async (label) => {
    const data = await appPage.evaluate(() => ({
      visible: !document.querySelector("#captureModal").classList.contains("hidden"),
      board: document.querySelector("#captureBoard")?.value || "",
      column: document.querySelector("#captureColumn")?.value || "",
    }));
    if (!data.visible || !data.board || !data.column) {
      fail("capture", `${label}: default board/column missing`, data);
    }
  };
  await gotoView(appPage, appBase, "today");
  await appPage.click("#sidebarPlusButton");
  await appPage.waitForTimeout(150);
  await appPage.click("#sidebarQuickCapture");
  await appPage.waitForTimeout(200);
  await readCapture("sidebar Quick capture");
  await appPage.keyboard.press("Escape");
  await appPage.waitForTimeout(150);
  await appPage.locator("body").press("c");
  await appPage.waitForTimeout(200);
  await readCapture("keyboard C");
  await appPage.keyboard.press("Escape");
  await appPage.waitForTimeout(150);
}

async function modalAudit(appPage, appBase) {
  await gotoView(appPage, appBase, "board");
  await appPage.click("#newBoardButton");
  await appPage.waitForTimeout(250);
  const create = await appPage.evaluate(() => {
    const modal = document.querySelector("#boardCreateModal");
    return {
      visible: !modal.classList.contains("hidden"),
      width: Math.round(modal.querySelector(".modal").getBoundingClientRect().width),
      title: modal.querySelector("h2")?.textContent?.trim(),
      placeholder: modal.querySelector("#boardCreateName")?.getAttribute("placeholder"),
      descriptionTag: modal.querySelector("#boardCreateDescription")?.tagName,
      descriptionMax: modal.querySelector("#boardCreateDescription")?.getAttribute("maxlength"),
      privateLabel: modal.querySelector("#boardCreateVisibility")?.options[1]?.textContent,
    };
  });
  if (!create.visible) fail("modal", "board create did not open");
  if (create.width !== 560) fail("modal", "board create width differs from reference", create);
  if (create.title !== "A new board") fail("modal", "board create title differs from reference", create);
  if (create.descriptionTag !== "INPUT" || create.descriptionMax !== "200") {
    fail("modal", "board create description field differs from reference", create);
  }
  if (create.privateLabel !== "Private to me") fail("modal", "board create private label differs", create);
  await appPage.click("#closeBoardCreate");
  await appPage.waitForTimeout(150);

  await appPage.evaluate(() => document.querySelector("#boardSettingsButton")?.click());
  await appPage.waitForTimeout(200);
  const settings = await appPage.evaluate(() => {
    const modal = document.querySelector("#boardSettingsModal");
    return {
      visible: !modal.classList.contains("hidden"),
      width: Math.round(modal.querySelector(".modal").getBoundingClientRect().width),
      privateLabel: modal.querySelector("#boardSettingsVisibility")?.options[1]?.textContent,
    };
  });
  if (!settings.visible) fail("modal", "board settings did not open");
  if (settings.width !== 520) fail("modal", "board settings width differs", settings);
  if (settings.privateLabel !== "Only me and workspace admins") {
    fail("modal", "board settings private label differs", settings);
  }
  await appPage.evaluate(() => document.querySelector("#cancelBoardSettings")?.click());
  await appPage.waitForTimeout(150);

  await appPage.click("#boardAddTaskButton");
  await appPage.waitForTimeout(200);
  const column = await appPage.evaluate(() => {
    const modal = document.querySelector("#columnModal");
    return {
      visible: !modal.classList.contains("hidden"),
      width: Math.round(modal.querySelector(".modal").getBoundingClientRect().width),
      title: modal.querySelector("h2")?.textContent?.trim(),
    };
  });
  if (!column.visible) fail("modal", "column modal did not open");
  if (column.width !== 420) fail("modal", "column modal width differs", column);
  if (column.title !== "Add a column") fail("modal", "column modal title differs", column);
  await appPage.evaluate(() => document.querySelector("#closeColumnModal")?.click());
  await appPage.waitForTimeout(150);

  await appPage.click("#shortcutsButton");
  await appPage.waitForTimeout(200);
  const shortcuts = await appPage.evaluate(() => {
    const modal = document.querySelector("#shortcutsModal");
    return {
      visible: !modal.classList.contains("hidden"),
      width: Math.round(modal.querySelector(".modal").getBoundingClientRect().width),
    };
  });
  if (!shortcuts.visible) fail("modal", "shortcut sheet did not open");
  if (shortcuts.width !== 560) fail("modal", "shortcut sheet width differs", shortcuts);
  await appPage.keyboard.press("Escape");
  await appPage.waitForTimeout(150);
}

async function autoPlanAudit(appPage, appBase) {
  await gotoView(appPage, appBase, "today");
  const review = appPage.locator("#todayPlanReview");
  if (!(await review.count())) {
    warn("auto-plan", "Today review control is not present");
    return;
  }
  await review.click();
  await appPage.waitForTimeout(900);
  const data = await appPage.evaluate(() => {
    const modal = document.querySelector(".auto-plan-modal");
    const text = document.querySelector("#autoPlanPreview")?.innerText || "";
    return {
      visible: !document.querySelector("#autoPlanModal").classList.contains("hidden"),
      width: modal ? Math.round(modal.getBoundingClientRect().width) : 0,
      options: document.querySelectorAll(".auto-plan-options .auto-plan-option").length,
      detail: Boolean(document.querySelector(".auto-plan-detail")),
      sideBlocks: document.querySelectorAll(".auto-plan-side-block").length,
      footer: document.querySelector("#autoPlanFooterNote")?.textContent?.trim() || "",
      hasIsoDate: /\b\d{4}-\d{2}-\d{2}\b/.test(text),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  if (!data.visible) fail("auto-plan", "Auto-plan modal did not open");
  if (data.width < 900) fail("auto-plan", "Auto-plan modal is not using the reference width", data);
  if (data.options !== 3) fail("auto-plan", "Auto-plan option cards missing", data);
  if (!data.detail) fail("auto-plan", "Auto-plan detail pane missing");
  if (!data.sideBlocks) fail("auto-plan", "Auto-plan weekly/warning side pane missing");
  if (!data.footer) fail("auto-plan", "Auto-plan footer note missing");
  if (data.hasIsoDate) fail("auto-plan", "Auto-plan is showing raw ISO dates");
  if (data.overflow > 0) fail("auto-plan", "Auto-plan causes horizontal overflow", data);
  await appPage.keyboard.press("Escape");
  await appPage.waitForTimeout(150);
  if (await appPage.locator("#autoPlanModal").isVisible()) {
    fail("auto-plan", "Escape does not close Auto-plan");
  }
}

async function workspaceSessionAudit(appPage, appBase, browser) {
  await gotoView(appPage, appBase, "today");
  await appPage.locator("#workspaceMenuButton").click();
  await appPage.waitForTimeout(150);
  const create = appPage.locator("#workspaceMenu .menu-item").last();
  const menu = await create.evaluate((element) => ({
    text: element.textContent.replace(/\s+/g, " ").trim(),
    icon: element.querySelector("use")?.getAttribute("href") || "",
  }));
  if (!/Create a team workspace|建立團隊工作區/.test(menu.text)) {
    fail("workspace", "workspace menu does not expose the create action", menu);
  }
  if (!menu.icon.includes("plus")) fail("workspace", "create workspace menu item is missing the plus icon", menu);
  await create.click();
  await appPage.waitForTimeout(900);
  const landing = await appPage.evaluate(() => {
    const section = document.querySelector("#settings-workspace");
    const rect = section?.getBoundingClientRect();
    return {
      href: window.location.href,
      active: document.querySelector(".settings-nav-item.active")?.dataset.section || "",
      inView: Boolean(rect && rect.top >= -50 && rect.top < window.innerHeight),
    };
  });
  if (!/\/settings#workspace$/.test(landing.href)) {
    fail("workspace", "create workspace did not open the workspace settings", landing);
  }
  if (!landing.inView || landing.active !== "workspace") {
    fail("workspace", "workspace settings did not land on the create form", landing);
  }
  const accountAction = await appPage.evaluate(() => {
    const button = document.querySelector("#settings-account button.btn.danger");
    return {
      exists: Boolean(button),
      text: button?.textContent.replace(/\s+/g, " ").trim() || "",
    };
  });
  if (!accountAction.exists) {
    fail("session", "Settings > Account does not expose Sign out", accountAction);
  }

  const guestContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
  try {
    const guestPage = await guestContext.newPage();
    await guestPage.goto(appBase + "/", { waitUntil: "networkidle" });
    await guestPage.waitForTimeout(800);
    await guestPage.locator("#themeMenuButton").click();
    await guestPage.waitForTimeout(150);
    const signIn = guestPage.locator("#themeAccountMenu .menu-item").last();
    const signInText = await signIn.textContent();
    if (!/Sign in|登入/.test(signInText || "")) {
      fail("session", "guest account menu does not expose Sign in", { text: signInText });
    }
    await signIn.click();
    await guestPage.waitForTimeout(600);
    if (!/\/auth(?:$|[?#])/.test(guestPage.url())) {
      fail("session", "guest Sign in did not open /auth", { url: guestPage.url() });
    } else if (!(await guestPage.locator("#signinForm").isVisible())) {
      fail("session", "auth page did not show the sign-in form");
    } else {
      const title = await guestPage.locator("#authTitle").textContent();
      if (!/Welcome back/.test(title || "")) {
        fail("session", "guest Sign in opened the claim screen instead of sign-in", { title });
      }
    }
  } finally {
    await guestContext.close();
  }

  const authContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
  try {
    const authPage = await authContext.newPage();
    await login(authPage, appBase);
    await authPage.goto(appBase + "/settings", { waitUntil: "networkidle" });
    await authPage.waitForTimeout(700);
    await authPage.evaluate(() => {
      for (const key of ["drift-bootstrap.v1", "drift-settings.v1", "drift-board.v1:audit", "drift-today.v1:audit"]) {
        window.localStorage.setItem(key, "{\"audit\":true}");
      }
    });
    const signOut = authPage.locator("#settings-account button.btn.danger");
    if ((await signOut.count()) !== 1) {
      fail("session", "Settings > Account sign-out button is missing", { count: await signOut.count() });
    } else {
      await signOut.click();
      await authPage.waitForTimeout(900);
      if (!/\/auth(?:$|[?#])/.test(authPage.url())) {
        fail("session", "Sign out did not return to /auth", { url: authPage.url() });
      }
      const leftover = await authPage.evaluate(() =>
        Object.keys(window.localStorage).filter((key) =>
          key === "drift-bootstrap.v1"
          || key === "drift-settings.v1"
          || key.startsWith("drift-board.v1:")
          || key.startsWith("drift-today.v1:"),
        ),
      );
      if (leftover.length) fail("session", "Sign out left cached account data behind", leftover);
    }
  } finally {
    await authContext.close();
  }
}

async function translationAudit(appPage, appBase) {
  const forbidden = [
    "Example:",
    "minutes available to the Today planner",
    "Generate plans in Today",
    "Every scheduled block leaves this much space",
    "Recompute while the app is open",
    "Long work can be split into sessions",
    "When a task is longer than the focus block",
    "Allow Saturday and Sunday",
    "Used only when a task has no estimate",
    "Stop scheduling new work",
    "Reserve a daily break before Auto-plan",
    "Two-factor authentication is TOTP",
    "Personal by default. Add a team",
    "API tokens, webhooks, calendar feed",
    "Every policy and content mutation",
    "No blockers. This task can move freely.",
    "Due time has passed",
    "Daily capacity reached",
    "Weekly capacity reached",
    "tasks used the default estimate",
    "tasks could not be placed within the horizon",
    "Task created",
    "Task moved",
    "Task completed",
    "Task deleted",
    "Comment added",
    "7 days",
    "Create workspace",
  ];
  const check = async (label) => {
    const text = await appPage.evaluate(() => document.body.innerText);
    for (const phrase of forbidden) {
      if (text.includes(phrase)) fail("translation", `${label}: untranslated UI text "${phrase}"`);
    }
  };
  await appPage.goto(appBase + "/?view=today", { waitUntil: "networkidle" });
  await appPage.evaluate(async () => fetch("/api/settings", {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ locale: "zh-TW" }),
  }));
  await appPage.reload({ waitUntil: "networkidle" });
  await appPage.waitForTimeout(600);
  for (const view of ["today", "board", "upcoming", "calendar", "search", "archive", "insights"]) {
    await gotoView(appPage, appBase, view);
    await check(view);
  }
  await appPage.goto(appBase + "/settings", { waitUntil: "networkidle" });
  await appPage.waitForTimeout(800);
  await check("settings");
  await gotoView(appPage, appBase, "today");
  const review = appPage.locator("#todayPlanReview");
  if (await review.count()) {
    await review.click();
    await appPage.waitForTimeout(700);
    await check("auto-plan");
    await appPage.keyboard.press("Escape");
    await appPage.waitForTimeout(200);
  }
  await appPage.locator(".focus-title").first().click();
  await appPage.waitForTimeout(600);
  await check("task drawer");
  await appPage.keyboard.press("Escape");
  await appPage.evaluate(async () => fetch("/api/settings", {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ locale: "en" }),
  }));
}

async function completedTransition(appPage, appBase) {
  const setup = await appPage.evaluate(async () => {
    const boot = await (await fetch("/api/bootstrap")).json();
    const workspace = boot.workspaces[0];
    const board = await (
      await fetch("/api/boards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: workspace.id, name: "Parity audit board", template: "blank" }),
      })
    ).json();
    const payload = await (await fetch("/api/boards/" + board.board.id)).json();
    const columnId = payload.board.columns[0].id;
    const task = await (
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          boardId: board.board.id,
          columnId,
          title: "Parity transition task",
        }),
      })
    ).json();
    return { workspaceId: workspace.id, boardId: board.board.id, columnId, taskId: task.task.id };
  });

  try {
    await appPage.goto(appBase + "/?view=board&board=" + setup.boardId, { waitUntil: "networkidle" });
    await appPage.waitForTimeout(400);
    const drag = (toDone) =>
      appPage.evaluate(
        ({ toDone, columnId }) => {
          const card = [...document.querySelectorAll("#board .card")].find((item) =>
            item.innerText.includes("Parity transition task"),
          );
          const columns = [...document.querySelectorAll("#board section.column")];
          const target = toDone
            ? columns.find((item) => item.querySelector(".column-title")?.innerText.trim().startsWith("Done"))
            : columns.find((item) => item.querySelector(".column-title")?.innerText.trim().startsWith("To do"));
          if (!card || !target) return false;
          const transfer = new DataTransfer();
          card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
          target.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: transfer }));
          target.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
          card.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }));
          return true;
        },
        { toDone, columnId: setup.columnId },
      );
    if (!(await drag(true))) throw new Error("could not locate card/column for drag");
    await appPage.waitForTimeout(900);
    const done = await cardSnapshots(appPage, "#board .card", "h3");
    const doneCard = done.find((card) => card.title.includes("Parity transition task"));
    if (!doneCard) fail("transition", "task missing after drag to Done");
    else {
      if (!doneCard.completed) fail("transition", "task did not enter completed state after drag to Done");
      if (doneCard.decoration !== "line-through") fail("transition", "completed task is missing line-through");
      const muted = await appPage.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--muted)";
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      if (doneCard.color !== muted) {
        fail("transition", "completed task title does not use --muted", { actual: doneCard.color, expected: muted });
      }
    }
    if (!(await drag(false))) throw new Error("could not locate card/column for reverse drag");
    await appPage.waitForTimeout(900);
    const reopened = (await cardSnapshots(appPage, "#board .card", "h3")).find((card) =>
      card.title.includes("Parity transition task"),
    );
    if (!reopened) fail("transition", "task missing after drag back");
    else {
      if (reopened.completed) fail("transition", "task stayed completed after drag back");
      if (reopened.decoration !== "none") fail("transition", "reopened task still has line-through");
    }
  } finally {
    await appPage.evaluate(async (boardId) => {
      await fetch("/api/boards/" + boardId, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    }, setup.boardId);
  }
}

function staticAudit() {
  const html = fs.readFileSync(path.join(ROOT, "src/main/resources/static/index.html"), "utf8");
  const js = fs.readFileSync(path.join(ROOT, "src/main/resources/static/app.js"), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length) fail("static", "duplicate HTML ids", duplicates);
  const refs = new Set([
    ...[...js.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]),
    ...[...js.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]),
  ]);
  const idSet = new Set(ids);
  const missingIds = [...refs].filter((id) => !idSet.has(id));
  if (missingIds.length) fail("static", "JS references missing HTML ids", missingIds);
  const symbols = new Set([...html.matchAll(/<symbol id="([^"]+)"/g)].map((match) => match[1]));
  const used = new Set([
    ...[...html.matchAll(/#(i-[A-Za-z0-9_-]+)/g)].map((match) => match[1]),
    ...[...js.matchAll(/#(i-[A-Za-z0-9_-]+)/g)].map((match) => match[1]),
    ...[...js.matchAll(/icon\("([^"]+)"/g)].map((match) => "i-" + match[1]),
  ]);
  const missingSymbols = [...used].filter((symbol) => !symbols.has(symbol));
  if (missingSymbols.length) fail("static", "missing SVG symbols", missingSymbols);

  const i18nCode = fs.readFileSync(path.join(ROOT, "src/main/resources/static/i18n.js"), "utf8");
  const sandbox = {
    window: {
      addEventListener() {},
      dispatchEvent() {},
      localStorage: { getItem() { return null; }, setItem() {} },
    },
    document: {
      documentElement: { lang: "en", dataset: {} },
      body: null,
      querySelectorAll() { return []; },
      createTreeWalker() { return { nextNode() { return false; }, currentNode: null }; },
      addEventListener() {},
    },
    NodeFilter: { SHOW_TEXT: 4 },
    CustomEvent: class {},
    console,
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(i18nCode, sandbox);
  const dictionary = sandbox.window.DriftI18n.dictionary;
  const authHtml = fs.readFileSync(path.join(ROOT, "src/main/resources/static/auth.html"), "utf8");
  const keys = new Set();
  for (const match of js.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(match[1].replace(/\\"/g, '"'));
  for (const match of (html + authHtml).matchAll(/>([^<>{}\n][^<>{}\n]{2,})</g)) {
    const value = match[1].trim();
    if (/^[A-Z][A-Za-z0-9 ,.'?&()/!-]+$/.test(value)) keys.add(value);
  }
  const missingKeys = [...keys].filter((key) => !(key in dictionary)).sort();
  if (missingKeys.length) fail("i18n", "missing translation keys", missingKeys);
  stats.ids = ids.length;
  stats.jsIdRefs = refs.size;
  stats.svgSymbols = symbols.size;
  stats.i18nSourceKeys = keys.size;
  stats.i18nMissing = missingKeys.length;
}

async function main() {
  staticAudit();
  const browser = await chromium.launch({ headless: true });
  try {
    const contextOptions = { viewport: { width: 1440, height: 1000 }, colorScheme: "light" };
    const refContext = await browser.newContext(contextOptions);
    const appContext = await browser.newContext(contextOptions);
    const refPage = await refContext.newPage();
    const appPage = await appContext.newPage();
    const refErrors = [];
    const appErrors = [];
    refPage.on("pageerror", (error) => refErrors.push("PAGE " + error.message));
    refPage.on("console", (message) => {
      if (message.type() === "error") refErrors.push("CONSOLE " + message.text());
    });
    appPage.on("pageerror", (error) => appErrors.push("PAGE " + error.message));
    appPage.on("console", (message) => {
      if (message.type() === "error") appErrors.push("CONSOLE " + message.text());
    });
    await login(refPage, REF_BASE);
    await login(appPage, APP_BASE);
    await appPage.evaluate(async () => {
      await fetch("/api/settings", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: "en" }),
      });
    });

    const views = ["today", "board", "upcoming", "calendar", "search", "archive", "insights"];
    for (const view of views) {
      refErrors.length = 0;
      appErrors.length = 0;
      await gotoView(refPage, REF_BASE, view);
      await gotoView(appPage, APP_BASE, view);
      await bodyAudit(refPage, view, "reference", true);
      await bodyAudit(appPage, view, "app", view === "upcoming" && false);
      if (appErrors.length) fail("console", `app ${view}: console errors`, [...new Set(appErrors)]);
      if (refErrors.length) warn("console", `reference ${view}: console errors`, [...new Set(refErrors)]);
    }

    await gotoView(refPage, REF_BASE, "board");
    await gotoView(appPage, APP_BASE, "board");
    await compareCardSets(refPage, appPage);
    await compareListView(refPage, appPage);

    const styleProps = [
      "color",
      "backgroundColor",
      "borderTopWidth",
      "borderRadius",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "marginTop",
      "marginBottom",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "textDecorationLine",
      "opacity",
      "alignItems",
      "justifyContent",
    ];
    const stylePairs = [
      { label: "board title", ref: ".page-title", app: "#boardTitle" },
      { label: "completed card", ref: ".task-card.completed", app: ".card.completed" },
      { label: "open card", ref: ".task-card:not(.completed)", app: ".card:not(.completed)" },
      { label: "completed title", ref: ".task-card.completed .task-title", app: ".card.completed h3" },
      { label: "open title", ref: ".task-card:not(.completed) .task-title", app: ".card:not(.completed) h3" },
      { label: "completed top line", ref: ".task-card.completed .task-topline", app: ".card.completed .card-top-meta" },
      { label: "completed footer", ref: ".task-card.completed .task-foot", app: ".card.completed .card-foot" },
      { label: "add column", ref: "button.column:last-child", app: ".column-add-column" },
      { label: "add task", ref: ".column-add", app: ".add-card" },
    ];
    for (const pair of stylePairs) {
      const expected = await style(refPage, pair.ref, styleProps);
      const actual = await style(appPage, pair.app, styleProps);
      compareValues("styles", pair.label, expected, actual, styleProps, {
        paddingTop: 0.5,
        paddingRight: 0.5,
        paddingBottom: 0.5,
        paddingLeft: 0.5,
        marginTop: 0.5,
        marginBottom: 0.5,
        minHeight: 1,
        lineHeight: 1,
      });
    }

    const addGeometry = async (page, selector) =>
      page.evaluate((selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const icon = element.querySelector("svg");
        return {
          top: rect.top,
          height: rect.height,
          paddingTop: getComputedStyle(element).paddingTop,
          iconOffset: icon ? icon.getBoundingClientRect().top - rect.top : null,
        };
      }, selector);
    const refAdd = await addGeometry(refPage, "button.column:last-child");
    const appAdd = await addGeometry(appPage, ".column-add-column");
    if (!refAdd || !appAdd) fail("layout", "add-column element missing");
    else {
      if (Math.abs(refAdd.iconOffset - appAdd.iconOffset) > 1) {
        fail("layout", "add-column icon offset differs", { reference: refAdd.iconOffset, app: appAdd.iconOffset });
      }
      const appColumnHeight = await appPage.evaluate(() => {
        const column = document.querySelector(".column");
        return column ? column.getBoundingClientRect().height : null;
      });
      if (appColumnHeight == null || Math.abs(appAdd.height - appColumnHeight) > 2) {
        fail("layout", "add-column does not fill the app column", {
          addColumn: appAdd.height,
          column: appColumnHeight,
        });
      }
    }

    const refDark = await refPage.evaluate(() => {
      const root = document.documentElement;
      const previous = root.dataset.theme;
      root.dataset.theme = "dark";
      const element = document.querySelector(".task-card.completed .task-title");
      const color = element ? getComputedStyle(element).color : null;
      root.dataset.theme = previous || "";
      return color;
    });
    const appDark = await appPage.evaluate(() => {
      const root = document.documentElement;
      const previous = root.dataset.theme;
      root.dataset.theme = "dark";
      const element = document.querySelector(".card.completed h3");
      const color = element ? getComputedStyle(element).color : null;
      root.dataset.theme = previous || "";
      return color;
    });
    if (refDark !== appDark) fail("styles", "dark completed title color differs", { reference: refDark, app: appDark });

    await overlayAudit(refPage, appPage, APP_BASE);
    await captureAudit(appPage, APP_BASE);
    await modalAudit(appPage, APP_BASE);
    await autoPlanAudit(appPage, APP_BASE);
    await workspaceSessionAudit(appPage, APP_BASE, browser);
    await onePageAudit(appPage, APP_BASE);
    await translationAudit(appPage, APP_BASE);
    await responsiveAudit(appPage, APP_BASE);
    await completedTransition(appPage, APP_BASE);
    if (appErrors.length) fail("console", "app console errors during interaction audit", [...new Set(appErrors)]);

    await appPage.goto(APP_BASE + "/?view=board", { waitUntil: "networkidle" });
    await appPage.waitForTimeout(300);
    await appPage.screenshot({ path: path.join(OUT, "app-board.png") });
    await refPage.screenshot({ path: path.join(OUT, "reference-board.png") });
  } finally {
    await browser.close();
  }

  const report = { stats, failures, warnings };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
