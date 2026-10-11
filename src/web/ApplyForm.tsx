import { useEffect, useRef, useState } from "preact/hooks";
import { DISPLAY_NAME_MAX, NOTE_MAX } from "../shared/limits";
import type { MeResponse } from "../shared/types";
import { ApiRequestError, UnauthorizedError, submitApplication } from "./api";
import { loadTurnstile } from "./turnstile";

interface Props {
  siteKey: string;
  getAccessToken: () => Promise<string | null>;
  onSubmitted: (me: MeResponse) => void;
  onAlreadyApplied: () => void;
}

export function ApplyForm({ siteKey, getAccessToken, onSubmitted, onAlreadyApplied }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((turnstile) => {
        const element = container.current;
        if (cancelled || !element) return;
        widgetId.current = turnstile.render(element, {
          sitekey: siteKey,
          callback: (value) => setToken(value),
          "error-callback": () => {
            setToken(null);
            setMessage("The verification check failed to load. Reload the page and try again.");
          },
          "expired-callback": () => setToken(null),
        });
      })
      .catch(() => {
        if (!cancelled) setMessage("Could not load the verification check. Reload the page and try again.");
      });
    return () => {
      cancelled = true;
      if (widgetId.current) {
        window.turnstile?.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [siteKey]);

  // A Turnstile token works only once, so get a fresh one after every attempt.
  function resetCheck() {
    setToken(null);
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
  }

  async function submit(event: Event) {
    event.preventDefault();
    if (busy) return;
    if (!token) {
      setMessage("Please complete the verification check first.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setMessage("Your session ended. Sign out and sign in again.");
        return;
      }
      const me = await submitApplication(accessToken, { displayName, note, turnstileToken: token });
      onSubmitted(me);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        onAlreadyApplied();
        return;
      }
      if (err instanceof UnauthorizedError) {
        setMessage("Your session ended. Sign out and sign in again.");
      } else if (err instanceof ApiRequestError) {
        setMessage(err.message);
      } else {
        setMessage("Could not submit your application. Try again.");
      }
      resetCheck();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label>
        Display Name
        <input
          type="text"
          required
          maxLength={DISPLAY_NAME_MAX}
          value={displayName}
          onInput={(e) => setDisplayName(e.currentTarget.value)}
        />
      </label>
      <label>
        Anything we should know? (optional)
        <textarea
          rows={4}
          maxLength={NOTE_MAX}
          value={note}
          onInput={(e) => setNote(e.currentTarget.value)}
        />
      </label>
      <div ref={container} />
      <button type="submit" disabled={busy || !token}>
        {busy ? "Submitting…" : "Apply"}
      </button>
      {message && <p role="alert">{message}</p>}
    </form>
  );
}
