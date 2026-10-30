import { prisma } from "./db";
import { ApiError } from "./errors";
import { appUrl, featureFlags } from "./env";
import { queueEmail, magicLinkEmail } from "./email";
import {
  hashPassword,
  normalizeBackupCode,
  randomToken,
  sha256,
  verifyPassword,
  verifyTotp,
  generateBackupCodes,
  encrypt,
  decrypt,
  generateTotpSecret,
  totpUri,
  signPayload,
  verifySignedPayload,
} from "./crypto";
import { mergeGuestWorkspace, createStarterWorkspaceForUser, type Viewer } from "./session";
import { safeTimeZone } from "./time";

export async function requestMagicLink(email: string, clientIp: string, next = "/", state = "") {
  const token = randomToken(32);
  await prisma.magicLinkToken.create({
    data: {
      tokenHash: sha256(token),
      email,
      purpose: "login",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      ipHash: sha256(clientIp).slice(0, 32),
    },
  });
  const payload = magicLinkEmail(email, token, next, state);
  await queueEmail(payload);
  return { token, devUrl: featureFlags.devEmailPreview ? `${appUrl()}/api/auth/magic/verify?token=${encodeURIComponent(token)}${state ? `&state=${encodeURIComponent(state)}` : ""}&next=${encodeURIComponent(next)}` : undefined };
}

export async function signupGuest(viewer: Viewer, input: { name: string; email: string; password: string; timezone?: string }) {
  if (!viewer.user.isGuest) throw new ApiError("CONFLICT", "You are already signed in with an account.");
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new ApiError("EMAIL_TAKEN");
  const passwordHash = await hashPassword(input.password);
  const timezone = safeTimeZone(input.timezone, "UTC");
  const user = await prisma.user.update({
    where: { id: viewer.user.id },
    data: {
      name: input.name,
      email: input.email,
      passwordHash,
      emailVerified: new Date(),
      isGuest: false,
      timezone,
    },
  });
  await prisma.session.updateMany({
    where: { userId: viewer.user.id },
    data: { mfaVerifiedAt: new Date() },
  });
  await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id, capacityMinutes: 300 },
    update: {},
  });
  return user;
}

export async function authenticateWithPassword(input: { email: string; password: string; totp?: string }, meta: { ip: string; userAgent?: string | null; guestId?: string | null }) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || user.deletedAt || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new ApiError("INVALID_CREDENTIALS");
  }
  if (user.mfaEnabled) {
    if (!input.totp) {
      return {
        mfaRequired: true as const,
        challenge: signPayload({ sub: user.id, purpose: "mfa" }, 300),
      };
    }
    const validTotp = user.mfaSecretEnc ? verifyTotp(decrypt(user.mfaSecretEnc), input.totp) : false;
    let validBackup = false;
    if (!validTotp && user.mfaBackupCodesJson) {
      const codes = JSON.parse(user.mfaBackupCodesJson) as string[];
      const normalized = normalizeBackupCode(input.totp);
      const targetHash = sha256(normalized);
      const index = codes.findIndex((stored) => stored === targetHash);
      if (index >= 0) {
        validBackup = true;
        const remaining = codes.filter((_, i) => i !== index);
        await prisma.user.update({ where: { id: user.id }, data: { mfaBackupCodesJson: JSON.stringify(remaining) } });
      }
    }
    if (!validTotp && !validBackup) throw new ApiError("INVALID_CREDENTIALS", "That code is not valid.");
  }
  if (meta.guestId && meta.guestId !== user.id) {
    await mergeGuestWorkspace(meta.guestId, user.id).catch((error) => {
      console.error(JSON.stringify({ level: "error", message: "guest merge failed", error: String(error) }));
    });
  }
  return { mfaRequired: false as const, user, mfaVerified: true };
}

export async function verifyMfaChallenge(challenge: string, code: string, meta: { ip: string; userAgent?: string | null }) {
  const payload = verifySignedPayload<{ sub: string; purpose: string }>(challenge);
  if (!payload || payload.purpose !== "mfa") throw new ApiError("INVALID_TOKEN", "The verification window expired. Sign in again.");
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user?.mfaEnabled || !user.mfaSecretEnc) throw new ApiError("INVALID_CREDENTIALS");
  const validTotp = verifyTotp(decrypt(user.mfaSecretEnc), code);
  if (!validTotp && user.mfaBackupCodesJson) {
    const codes = JSON.parse(user.mfaBackupCodesJson) as string[];
    const target = sha256(normalizeBackupCode(code));
    const index = codes.findIndex((stored) => stored === target);
    if (index < 0) throw new ApiError("INVALID_CREDENTIALS", "That code is not valid.");
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaBackupCodesJson: JSON.stringify(codes.filter((_, i) => i !== index)) },
    });
  } else if (!validTotp) {
    throw new ApiError("INVALID_CREDENTIALS", "That code is not valid.");
  }
  void meta;
  return { user, mfaVerified: true };
}

export async function consumeMagicToken(token: string) {
  const record = await prisma.magicLinkToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) throw new ApiError("INVALID_TOKEN");
  // Atomic claim closes the read-then-write race between two verifier requests.
  const claimed = await prisma.magicLinkToken.updateMany({
    where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) throw new ApiError("INVALID_TOKEN");
  return record;
}

export async function userForMagicEmail(email: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.deletedAt) throw new ApiError("INVALID_TOKEN");
    // A magic link authenticates the email owner. It must never merge or claim
    // whichever guest session happens to be active in the browser that opens it.
    return existing;
  }
  const user = await prisma.user.create({
    data: { email, emailVerified: new Date(), name: email.split("@")[0]!, isGuest: false },
  });
  await createStarterWorkspaceForUser(user.id);
  return user;
}

export async function prepareMfa(userId: string, currentCode?: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError("UNAUTHORIZED");
  // Resetting an existing authenticator is a security-sensitive change. Require
  // proof from the current factor before replacing the secret.
  if (user.mfaEnabled) {
    if (!currentCode?.trim()) throw new ApiError("VALIDATION_ERROR", "Enter your current authenticator code to reset two-factor.");
    if (!user.mfaSecretEnc || !verifyTotp(decrypt(user.mfaSecretEnc), currentCode.trim())) {
      throw new ApiError("INVALID_CREDENTIALS", "That authenticator code is not valid.");
    }
  }
  const qrcode = (await import("qrcode")).default;
  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: userId }, data: { mfaSecretEnc: encrypt(secret), mfaEnabled: false } });
  const uri = totpUri(secret, user.email ?? "guest@drift.local");
  const qrDataUrl = await qrcode.toDataURL(uri, { margin: 1, width: 220, color: { dark: "#1f2925", light: "#ffffff" } });
  return { secret, uri, qrDataUrl };
}

export async function enableMfa(userId: string, sessionId: string, secret: string, code: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.mfaSecretEnc) throw new ApiError("VALIDATION_ERROR", "Start two-factor setup first.");
  if (decrypt(user.mfaSecretEnc) !== secret) throw new ApiError("VALIDATION_ERROR", "The setup secret changed. Start again.");
  if (!verifyTotp(secret, code)) throw new ApiError("INVALID_CREDENTIALS", "That code is not valid. Check your authenticator time.");
  const backupCodes = generateBackupCodes();
  const hashed = backupCodes.map((value) => sha256(normalizeBackupCode(value)));
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true, mfaBackupCodesJson: JSON.stringify(hashed) },
    }),
    prisma.session.update({ where: { id: sessionId }, data: { mfaVerifiedAt: new Date() } }),
    prisma.session.updateMany({ where: { userId, id: { not: sessionId } }, data: { revokedAt: new Date() } }),
  ]);
  return { backupCodes };
}

export async function disableMfa(userId: string, code: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { memberships: { include: { workspace: true } } } });
  if (!user?.mfaEnabled || !user.mfaSecretEnc) throw new ApiError("VALIDATION_ERROR", "Two-factor is not enabled.");
  if (user.memberships.some((membership) => membership.workspace.requireMfa)) {
    throw new ApiError("FORBIDDEN", "An organization you belong to requires MFA. Ask an admin before disabling it.");
  }
  let valid = verifyTotp(decrypt(user.mfaSecretEnc), code);
  if (!valid && user.mfaBackupCodesJson) {
    const codes = JSON.parse(user.mfaBackupCodesJson) as string[];
    const target = sha256(normalizeBackupCode(code));
    const index = codes.findIndex((stored) => stored === target);
    if (index >= 0) valid = true;
  }
  if (!valid) throw new ApiError("INVALID_CREDENTIALS", "That code is not valid.");
  await prisma.user.update({
    where: { id: userId },
    data: { mfaEnabled: false, mfaSecretEnc: null, mfaBackupCodesJson: null },
  });
}

export async function signInUserFromMagic(userId: string) {
  return prisma.user.findUniqueOrThrow({ where: { id: userId } });
}
