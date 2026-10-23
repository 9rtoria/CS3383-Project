import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/toast";
import { Runtime } from "@/components/runtime";

export const metadata: Metadata = {
  title: {
    default: "Drift — a calmer place for your tasks",
    template: "%s · Drift",
  },
  description:
    "Drift is a keyboard-first personal task planner and Kanban board. Start in seconds, stay calm, and add team structure only when you need it.",
  applicationName: "Drift",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Drift", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    title: "Drift — a calmer place for your tasks",
    description: "A personal task planner and Kanban board that stays out of your way.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f4ef" },
    { media: "(prefers-color-scheme: dark)", color: "#141815" },
  ],
};

const themeBootstrap = `
(function () {
  try {
    var stored = localStorage.getItem("drift-theme");
    var dark = stored === "dark" || ((!stored || stored === "system") && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (error) {
    document.documentElement.dataset.theme = "light";
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <ToastProvider>
          <Runtime />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
