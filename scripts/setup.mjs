#!/usr/bin/env node
/**
 * One-command local setup for Drift.
 * Creates .env with strong runtime secrets, applies migrations, and optionally
 * seeds the demo workspace. It never overwrites an existing .env.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");

function secret(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

console.log("Drift setup");
console.log(`Node ${process.version} · ${process.platform}`);

if (!fs.existsSync(examplePath)) {
  console.error("Missing .env.example. Run this from the project root.");
  process.exit(1);
}

if (fs.existsSync(envPath)) {
  console.log("• .env already exists; leaving it untouched.");
} else {
  let env = fs.readFileSync(examplePath, "utf8");
  env = env
    .replace('AUTH_SECRET=""', `AUTH_SECRET="${secret(48)}"`)
    .replace('APP_ENCRYPTION_KEY=""', `APP_ENCRYPTION_KEY="${secret(32)}"`)
    .replace('NODE_ENV="development"', 'NODE_ENV="development"');
  fs.writeFileSync(envPath, env, { mode: 0o600 });
  console.log("• Created .env with fresh AUTH_SECRET and APP_ENCRYPTION_KEY.");
}

fs.mkdirSync(path.join(root, "data", "attachments"), { recursive: true });
fs.mkdirSync(path.join(root, "data", "backups"), { recursive: true });

function run(label, command, args) {
  console.log(`• ${label}`);
  execFileSync(command, args, { stdio: "inherit", cwd: root, env: process.env });
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
run("Generating Prisma client", npx, ["prisma", "generate"]);
run("Applying database migrations", npx, ["prisma", "migrate", "deploy"]);

const seed = process.argv.includes("--seed") || process.env.SEED_DEMO === "true";
if (seed) {
  run("Seeding the demo workspace", npx, ["tsx", "prisma/seed.ts"]);
} else {
  console.log("• Skipping demo seed (set SEED_DEMO=true or pass --seed).");
}

console.log("\nReady.");
console.log("  npm run dev        start at http://localhost:3000");
console.log("  npm run test       unit tests");
console.log("  npm run test:e2e   Playwright journey tests");
if (seed) console.log("  Demo login         demo@drift.local / DriftDemo123!");
