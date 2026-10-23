#!/usr/bin/env node
/**
 * Authenticated Lighthouse smoke for the production server.
 *
 * Usage:
 *   npm run build
 *   npm run start -- -p 3200
 *   set PERF_URL=http://localhost:3200 && npm run test:perf
 *
 * The script creates a throwaway guest session and task through the real API,
 * passes the session cookie as an extra request header, and audits Today, Board,
 * and the task drawer. Results are written to docs/performance/*.json and *.html.
 * This is a lab smoke check, not a field INP measurement.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import * as chromeLauncher from "chrome-launcher";

import lighthouse from "lighthouse";

const base = (process.env.PERF_URL ?? "http://localhost:3000").replace(/\/$/, "");
const outDir = path.join(process.cwd(), "docs", "performance");
fs.mkdirSync(outDir, { recursive: true });

function requestHeaders(cookie) {
  return {
    Origin: base,
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

async function createFixture() {
  const guest = await fetch(`${base}/api/auth/guest`, {
    method: "POST",
    headers: requestHeaders(),
  });
  if (!guest.ok) throw new Error(`Guest bootstrap failed: ${guest.status} ${await guest.text()}`);
  const setCookie = guest.headers.getSetCookie?.()[0] ?? guest.headers.get("set-cookie");
  if (!setCookie) throw new Error("Guest bootstrap did not set a session cookie.");
  const cookie = setCookie.split(";")[0];

  const bootstrapResponse = await fetch(`${base}/api/bootstrap`, { headers: requestHeaders(cookie) });
  if (!bootstrapResponse.ok) throw new Error(`Bootstrap failed: ${bootstrapResponse.status}`);
  const bootstrap = await bootstrapResponse.json();
  const workspace = bootstrap.workspaces[0];
  const board = workspace?.boards[0];
  const column = board?.columns?.find((item) => !item.isDone) ?? board?.columns?.[0];
  if (!workspace || !board || !column) throw new Error("Guest fixture has no board/column.");

  const taskResponse = await fetch(`${base}/api/tasks`, {
    method: "POST",
    headers: {
      ...requestHeaders(cookie),
      "Content-Type": "application/json",
      "Idempotency-Key": `perf-${Date.now()}`,
      "X-Workspace-Id": workspace.id,
    },
    body: JSON.stringify({
      workspaceId: workspace.id,
      boardId: board.id,
      columnId: column.id,
      title: "Prepare the launch brief",
      description: "A representative card for the Lighthouse task-drawer audit.",
      priority: "high",
      estimateMinutes: 45,
      dueDate: new Date(Date.now() + 86_400_000).toISOString(),
    }),
  });
  if (!taskResponse.ok) throw new Error(`Task fixture failed: ${taskResponse.status} ${await taskResponse.text()}`);
  const created = await taskResponse.json();

  return {
    cookie,
    workspaceId: workspace.id,
    boardId: board.id,
    taskId: created.task.id,
  };
}

const pages = [
  { key: "today", label: "Today", url: "/" },
  { key: "board", label: "Board", url: "/?view=board" },
  { key: "task-drawer", label: "Task drawer", url: "/?view=board&task=__TASK_ID__" },
];

const fixture = await createFixture();
const chrome = await chromeLauncher.launch({
  chromePath: chromium.executablePath(),
  chromeFlags: [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-first-run",
    "--force-device-scale-factor=1",
  ],
  logLevel: "silent",
});

const results = [];
for (const target of pages) {
  const url = `${base}${target.url.replace("__TASK_ID__", fixture.taskId)}`;
  console.log(`Auditing ${target.label}: ${url}`);
  const runnerResult = await lighthouse(
    url,
    {
      port: chrome.port,
      output: ["json", "html"],
      logLevel: "error",
      onlyCategories: ["performance", "accessibility", "best-practices"],
      throttlingMethod: "simulate",
      extraHeaders: { Cookie: fixture.cookie },
    },
    {
      extends: "lighthouse:default",
      settings: {
        // Keep the audit honest and reproducible on a local machine.
        maxWaitForLoad: 60_000,
        skipAudits: ["canonical", "is-on-https", "redirects-http"],
      },
    },
  );
  const [json, html] = runnerResult.report;
  fs.writeFileSync(path.join(outDir, `${target.key}.json`), json);
  fs.writeFileSync(path.join(outDir, `${target.key}.html`), html);
  const audits = runnerResult.lhr.audits;
  const row = {
    page: target.label,
    performance: Math.round((runnerResult.lhr.categories.performance?.score ?? 0) * 100),
    accessibility: Math.round((runnerResult.lhr.categories.accessibility?.score ?? 0) * 100),
    bestPractices: Math.round((runnerResult.lhr.categories["best-practices"]?.score ?? 0) * 100),
    lcpMs: Math.round(audits["largest-contentful-paint"]?.numericValue ?? 0),
    cls: Number((audits["cumulative-layout-shift"]?.numericValue ?? 0).toFixed(3)),
    tbtMs: Math.round(audits["total-blocking-time"]?.numericValue ?? 0),
    totalBytes: Math.round(audits["total-byte-weight"]?.numericValue ?? 0),
  };
  results.push(row);
  console.log(`  ${row.performance}/100 performance · ${row.accessibility}/100 accessibility · ${row.bestPractices}/100 best practices · LCP ${row.lcpMs}ms · CLS ${row.cls} · TBT ${row.tbtMs}ms`);
}

fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ base, generatedAt: new Date().toISOString(), results }, null, 2));
console.log("\nMarkdown summary\n");
console.log("| Screen | Performance | Accessibility | Best practices | LCP | CLS | TBT |");
console.log("|---|---:|---:|---:|---:|---:|---:|");
for (const row of results) {
  console.log(`| ${row.page} | ${row.performance} | ${row.accessibility} | ${row.bestPractices} | ${row.lcpMs} ms | ${row.cls} | ${row.tbtMs} ms |`);
}
console.log(`\nReports: ${path.relative(process.cwd(), outDir)}`);

await chrome.kill();
