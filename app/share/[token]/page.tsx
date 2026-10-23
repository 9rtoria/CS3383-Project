import type { Metadata } from "next";
import { ShareBoard } from "./share-board";

export const metadata: Metadata = {
  title: "Shared board",
  description: "A read-only Drift board.",
  robots: { index: false, follow: false },
};

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ShareBoard token={token} />;
}
