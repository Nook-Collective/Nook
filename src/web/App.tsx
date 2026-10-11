import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "preact/hooks";
import type { MeResponse, PublicConfig } from "../shared/types";
import { ApplyForm } from "./ApplyForm";
import { UnauthorizedError, fetchConfig, fetchMe } from "./api";
import { getSupabase } from "./supabase";

type View =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "signed-out" }
  | { kind: "signed-in"; me: MeResponse };

function accountMessage(me: MeResponse): string {
  switch (me.state) {
    case "none":
      return "Apply for access below. An admin reviews every application.";
    case "pending":
      return "Your application is pending. An admin will review it.";
    case "rejected":
      return "Your application was not approved.";
    case "suspended":
      return "Your account is suspended.";
    case "approved":
      return me.role === "admin"
        ? "You are approved as an admin. Chat arrives in a later update."
        : "You are approved. Chat arrives in a later update.";
  }
}

export function App() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Looks up the account state for a session and shows it.
  async function showSession(session: Session | null) {
    if (!session) {
      setView({ kind: "signed-out" });
      return;
    }
    try {
      const me = await fetchMe(session.access_token);
      setView({ kind: "signed-in", me });
    } catch (err) {
      setView({
        kind: "error",
        message:
          err instanceof UnauthorizedError
            ? "Your sign-in was not accepted. Sign out and try again."
            : "Could not load your account. Try again shortly.",
      });
    }
  }

  async function getAccessToken(): Promise<string | null> {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function reload() {
    if (!client) return;
    const { data } = await client.auth.getSession();
    await showSession(data.session);
  }

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    async function start() {
      try {
        const loaded = await fetchConfig();
        if (cancelled) return;
        setConfig(loaded);
        const supabase = getSupabase(loaded);
        setClient(supabase);

        const { data } = await supabase.auth.getSession();
        await showSession(data.session);

        const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
          if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "TOKEN_REFRESHED") {
            void showSession(session);
          }
        });
        unsubscribe = () => listener.subscription.unsubscribe();
      } catch {
        if (!cancelled) setView({ kind: "error", message: "Could not reach the server." });
      }
    }

    void start();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  async function signIn() {
    if (!client) return;
    setNotice(null);
    const { error } = await client.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: window.location.origin },
    });
    if (error) setNotice("Could not start GitHub sign-in. Try again.");
  }

  async function signOut() {
    if (!client) return;
    setNotice(null);
    const { error } = await client.auth.signOut();
    if (error) setNotice("Could not sign out. Try again.");
  }

  return (
    <main>
      <h1>{config?.appName ?? "Nook"}</h1>
      {view.kind === "loading" && <p>Loading…</p>}
      {view.kind === "error" && (
        <>
          <p role="alert">{view.message}</p>
          {client && <button onClick={signOut}>Sign out</button>}
        </>
      )}
      {view.kind === "signed-out" && (
        <>
          <p>Sign in with GitHub to apply for access or to enter the community.</p>
          <button onClick={signIn}>Sign in with GitHub</button>
        </>
      )}
      {view.kind === "signed-in" && (
        <>
          <p>{accountMessage(view.me)}</p>
          {view.me.state === "none" && config && (
            <ApplyForm
              siteKey={config.turnstileSiteKey}
              getAccessToken={getAccessToken}
              onSubmitted={(me) => setView({ kind: "signed-in", me })}
              onAlreadyApplied={() => void reload()}
            />
          )}
          <button onClick={signOut}>Sign out</button>
        </>
      )}
      {notice && <p role="alert">{notice}</p>}
    </main>
  );
}
