import nodemailer from "nodemailer";
import { prisma } from "./db";
import { featureFlags, appUrl } from "./env";

type MailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  kind?: string;
  userId?: string | null;
  sendNow?: boolean;
};

/**
 * Persists every message before attempting delivery. SMTP is optional in local
 * development; queued messages can be inspected only in a development outbox.
 */
export async function queueEmail(input: MailInput) {
  const message = await prisma.emailMessage.create({
    data: {
      to: input.to,
      subject: input.subject,
      body: input.html ?? input.text,
      kind: input.kind ?? "generic",
      userId: input.userId ?? null,
      status: featureFlags.emailConfigured ? "queued" : "preview",
    },
  });
  if (input.sendNow && featureFlags.emailConfigured) {
    await attemptSend(message.id).catch(() => undefined);
  }
  return message;
}

export async function attemptSend(messageId: string): Promise<boolean> {
  if (!featureFlags.emailConfigured) return false;
  const message = await prisma.emailMessage.findUnique({ where: { id: messageId } });
  if (!message || message.status === "sent") return true;
  try {
    const transport = nodemailer.createTransport(process.env.SMTP_URL!);
    await transport.sendMail({
      from: process.env.SMTP_FROM ?? "Drift <hello@drift.local>",
      to: message.to,
      subject: message.subject,
      html: message.body,
      text: message.body.replace(/<[^>]+>/g, " "),
    });
    await prisma.emailMessage.update({ where: { id: message.id }, data: { status: "sent", sentAt: new Date(), error: null } });
    return true;
  } catch (error) {
    await prisma.emailMessage.update({
      where: { id: message.id },
      data: { status: "failed", error: error instanceof Error ? error.message.slice(0, 500) : "Unknown SMTP error" },
    });
    return false;
  }
}

export function magicLinkEmail(email: string, token: string, next = "/") {
  const url = `${appUrl().replace(/\/$/, "")}/api/auth/magic?token=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`;
  return {
    to: email,
    subject: "Your Drift sign-in link",
    text: `Sign in to Drift: ${url}\n\nThis link expires in 15 minutes and can be used once. If you didn't request it, you can ignore this email.`,
    html: `<p>Sign in to Drift:</p><p><a href="${url}">Open my Drift workspace</a></p><p style="color:#667">This link expires in 15 minutes and can be used once.</p>`,
    kind: "magic_link",
    sendNow: true,
  };
}

export function inviteEmail(email: string, workspaceName: string, role: string, token: string) {
  const url = `${appUrl().replace(/\/$/, "")}/invite/${encodeURIComponent(token)}`;
  return {
    to: email,
    subject: `You're invited to ${workspaceName} on Drift`,
    text: `Join ${workspaceName} as ${role.toLowerCase()}: ${url}`,
    html: `<p>You're invited to <strong>${workspaceName}</strong> on Drift as ${role.toLowerCase()}.</p><p><a href="${url}">Join workspace</a></p>`,
    kind: "invite",
    sendNow: true,
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[character] ?? character;
  });
}

export function digestEmail(to: string, name: string, sections: { title: string; lines: string[] }[]) {
  const blocks = sections
    .map((section) => `<h2>${escapeHtml(section.title)}</h2><ul>${section.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`)
    .join("");
  return {
    to,
    subject: "Your Drift daily plan",
    text: sections.map((section) => `${section.title}\n${section.lines.map((line) => `- ${line}`).join("\n")}`).join("\n\n"),
    html: `<p>Good morning, ${escapeHtml(name)}.</p>${blocks}<p><a href="${appUrl()}">Open Drift</a></p>`,
    kind: "digest",
    sendNow: true,
  };
}

export function reminderEmail(to: string, taskTitle: string, boardName: string, taskUrl: string) {
  return {
    to,
    subject: `Reminder: ${taskTitle}`,
    text: `${taskTitle}\n${boardName}\n\nOpen the task: ${taskUrl}`,
    html: `<p><strong>${escapeHtml(taskTitle)}</strong></p><p>${escapeHtml(boardName)}</p><p><a href="${taskUrl}">Open the task in Drift</a></p><p style="color:#667">You are receiving this because you set a reminder on this task.</p>`,
    kind: "reminder",
    sendNow: true,
  };
}
