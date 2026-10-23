export const metadata = { title: "Offline" };

import Link from "next/link";

export default function OfflinePage() {
  return (
    <main id="main" className="content narrow" style={{ paddingTop: 80 }}>
      <div className="card card-pad" style={{ textAlign: "center" }}>
        <div className="empty-mark" aria-hidden>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        </div>
        <h1 className="page-title" style={{ fontSize: 30 }}>
          You&apos;re offline
        </h1>
        <p className="page-subtitle" style={{ margin: "10px auto 18px" }}>
          Drift could not reach the server. Reopen the app once you are back online; anything you captured while the tab was open
          is kept on this device and will retry automatically.
        </p>
        <Link className="btn primary" href="/">
          Try again
        </Link>
      </div>
    </main>
  );
}
