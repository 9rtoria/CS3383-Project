import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { viewerFromCookies } from "@/lib/session";
import { SettingsClient } from "./settings-client";

export const metadata: Metadata = {
  title: "Settings",
  description: "Account, appearance, notifications, security, workspace policies, automations, integrations, audit, and data controls.",
};

export default async function SettingsPage() {
  const viewer = await viewerFromCookies();
  if (!viewer) redirect("/auth?next=/settings");
  return <SettingsClient />;
}
