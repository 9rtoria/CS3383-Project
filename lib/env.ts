import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type RuntimeSecrets = { authSecret: string; encryptionKey: string };

let cachedSecrets: RuntimeSecrets | null = null;

function loadRuntimeSecrets(): RuntimeSecrets {
  if (cachedSecrets) return cachedSecrets;
  const envAuth = process.env.AUTH_SECRET;
  const envKey = process.env.APP_ENCRYPTION_KEY;
  if (envAuth && envKey) {
    cachedSecrets = { authSecret: envAuth, encryptionKey: envKey };
    return cachedSecrets;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET and APP_ENCRYPTION_KEY are required in production.");
  }
  const file = path.join(process.cwd(), "data", "runtime-secrets.json");
  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as RuntimeSecrets;
    cachedSecrets = parsed;
    return parsed;
  }
  const created: RuntimeSecrets = {
    authSecret: crypto.randomBytes(48).toString("base64url"),
    encryptionKey: crypto.randomBytes(32).toString("base64url"),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(created), { mode: 0o600 });
  cachedSecrets = created;
  return created;
}

export function authSecret(): string {
  return loadRuntimeSecrets().authSecret;
}

export function encryptionKey(): string {
  return loadRuntimeSecrets().encryptionKey;
}

export function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "local";
}

export const featureFlags = {
  emailConfigured: Boolean(process.env.SMTP_URL),
  githubOAuth: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
  googleOAuth: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  appleOAuth: Boolean(process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET),
  aiKillSwitch: process.env.AI_KILL_SWITCH === "true",
  attachmentsDisabled: process.env.DISABLE_ATTACHMENTS === "true",
  // Test harnesses can opt in to local link previews; ordinary production cannot.
  devEmailPreview: process.env.NODE_ENV !== "production" || process.env.E2E === "true",
  demoEnabled: process.env.SEED_DEMO === "true",
} as const;
