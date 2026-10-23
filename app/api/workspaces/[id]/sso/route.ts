import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireWorkspace, recordAudit } from "@/lib/authz";
import { ssoConfigSchema } from "@/lib/validation";
import { encrypt, decrypt } from "@/lib/crypto";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer }) => {
    const { id } = await params;
    await requireWorkspace(viewer, id, "ADMIN", "sso:manage");
    const config = await prisma.oidcConfig.findUnique({ where: { workspaceId: id } });
    return ok({
      configured: Boolean(config),
      config: config
        ? {
            issuer: config.issuer,
            clientId: config.clientId,
            allowedDomains: config.allowedDomains,
            enabled: config.enabled,
            enforceSso: config.enforceSso,
            updatedAt: config.updatedAt,
          }
        : null,
    });
  });
}

export async function PUT(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer, body, requestId }) => {
    const { id } = await params;
    const access = await requireWorkspace(viewer, id, "ADMIN", "sso:manage");
    if (access.workspace.type !== "org") throw new ApiError("FEATURE_DISABLED", "Single sign-on is available for organization workspaces.");
    const input = ssoConfigSchema.parse({ ...(body as object), workspaceId: id });
    const existing = await prisma.oidcConfig.findUnique({ where: { workspaceId: id } });
    const clientSecret = input.clientSecret || (existing ? decrypt(existing.clientSecretEnc) : "");
    if (!clientSecret) throw new ApiError("VALIDATION_ERROR", "A client secret is required for the first configuration.");
    const config = await prisma.oidcConfig.upsert({
      where: { workspaceId: id },
      update: {
        issuer: input.issuer,
        clientId: input.clientId,
        clientSecretEnc: encrypt(clientSecret),
        allowedDomains: input.allowedDomains,
        enabled: input.enabled,
        enforceSso: input.enforceSso,
      },
      create: {
        workspaceId: id,
        issuer: input.issuer,
        clientId: input.clientId,
        clientSecretEnc: encrypt(clientSecret),
        allowedDomains: input.allowedDomains,
        enabled: input.enabled,
        enforceSso: input.enforceSso,
      },
    });
    await recordAudit({
      workspaceId: id,
      actorId: viewer.user.id,
      action: "sso.configured",
      entityType: "oidc_config",
      entityId: config.id,
      requestId,
      metadata: { issuer: config.issuer, enforceSso: config.enforceSso },
    });
    return ok({
      config: {
        issuer: config.issuer,
        clientId: config.clientId,
        allowedDomains: config.allowedDomains,
        enabled: config.enabled,
        enforceSso: config.enforceSso,
        updatedAt: config.updatedAt,
      },
    });
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer, requestId }) => {
    const { id } = await params;
    await requireWorkspace(viewer, id, "ADMIN", "sso:manage");
    await prisma.oidcConfig.deleteMany({ where: { workspaceId: id } });
    await recordAudit({
      workspaceId: id,
      actorId: viewer.user.id,
      action: "sso.removed",
      entityType: "oidc_config",
      entityId: id,
      requestId,
    });
    return ok({ removed: true });
  });
}
