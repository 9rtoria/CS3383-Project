import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { viewerFromCookies } from "@/lib/session";
import { InviteAccept } from "./invite-client";

export const metadata: Metadata = { title: "Workspace invitation" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const viewer = await viewerFromCookies();
  const invite = await prisma.invite.findUnique({
    where: { tokenHash: sha256(token) },
    include: { workspace: { select: { name: true, type: true, icon: true } } },
  });
  const valid = invite && !invite.acceptedAt && invite.expiresAt > new Date();
  const canAccept = Boolean(valid && viewer?.user.email && invite?.email.toLowerCase() === viewer.user.email.toLowerCase() && !viewer.user.isGuest);
  const masked = invite?.email.replace(/^(.).+(@.+)$/, "$1•••$2") ?? "";
  return (
    <InviteAccept
      token={token}
      valid={Boolean(valid)}
      workspaceName={invite?.workspace.name ?? ""}
      workspaceType={invite?.workspace.type ?? ""}
      role={invite?.role ?? "MEMBER"}
      maskedEmail={masked}
      viewerEmail={viewer?.user.email ?? null}
      isGuest={viewer?.user.isGuest ?? false}
      canAccept={canAccept}
    />
  );
}
