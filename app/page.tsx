import { redirect } from "next/navigation";
import { viewerFromCookies } from "@/lib/session";
import { AppRoot } from "@/components/app-root";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const viewer = await viewerFromCookies();
  if (!viewer) redirect("/api/auth/guest?next=/");
  return <AppRoot />;
}
