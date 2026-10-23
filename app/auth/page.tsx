import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { viewerFromCookies } from "@/lib/session";
import { featureFlags } from "@/lib/env";
import { AuthClient } from "./auth-client";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Save your Drift workspace to an account, or sign in with email and a one-time link.",
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const AUTH_ERRORS: Record<string, string> = {
  provider_unavailable: "That sign-in provider is not configured on this server.",
  state_mismatch: "The sign-in request expired. Start again from this page.",
  state_invalid: "The sign-in request could not be verified. Start again.",
  access_denied: "Sign-in was cancelled at the provider.",
  missing_code: "The provider did not return a sign-in code.",
  oauth_failed: "The provider sign-in could not be completed. Try again or use email.",
  sso_unavailable: "Single sign-on is not enabled for that workspace.",
  sso_discovery_failed: "The workspace identity provider could not be reached.",
  sso_failed: "Single sign-on could not be completed. Contact your workspace admin.",
  domain_not_allowed: "That email domain is not allowed for this workspace.",
  email_required: "The identity provider did not share an email address.",
  account_unavailable: "That account is no longer available.",
};

export default async function AuthPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const viewer = await viewerFromCookies();
  const claim = params.claim === "1" || (viewer?.user.isGuest ?? false);
  const challenge = typeof params.challenge === "string" ? params.challenge : "";
  const nextParam = typeof params.next === "string" && params.next.startsWith("/") && !params.next.startsWith("//") ? params.next : "/";
  if (viewer && !viewer.user.isGuest && !challenge && !claim) redirect(nextParam);
  return (
    <AuthClient
      initialClaim={claim}
      initialMode={params.mode === "magic" ? "magic" : params.mode === "signup" ? "signup" : "signin"}
      challenge={challenge}
      next={nextParam}
      guestName={viewer?.user.isGuest ? viewer.user.name : ""}
      providers={[
        { id: "github", label: "GitHub", enabled: featureFlags.githubOAuth },
        { id: "google", label: "Google", enabled: featureFlags.googleOAuth },
        { id: "apple", label: "Apple", enabled: featureFlags.appleOAuth },
      ]}
      signupAvailable={Boolean(viewer?.user.isGuest)}
      initialError={typeof params.error === "string" ? AUTH_ERRORS[params.error] ?? "Sign-in could not be completed. Please try again." : ""}
    />
  );
}
