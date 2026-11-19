import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { errorMessage } from "../api/client";
import { useAuth } from "../auth/useAuth";
import ProviderButton from "../components/ProviderButton";
import { PROVIDERS } from "../components/providers";
import type { LoginPayload, Provider, SocialAccount } from "../types";
import { cx, ui } from "../ui";

export default function ProfilePage() {
  const { user, loginWith, disconnect, logout } = useAuth();
  const [error, setError] = useState("");

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const connect = useCallback((provider: Provider) => (payload: LoginPayload) => run(() => loginWith(provider, payload)), [loginWith, run]);
  const onError = useCallback((msg: string) => setError(msg), []);

  // Rendered only inside <RequireAuth>, so the user is always present here.
  if (!user) return null;

  const linked: Partial<Record<Provider, SocialAccount>> = Object.fromEntries(user.social_accounts.map((a) => [a.provider, a]));
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username;

  return (
    <main className={ui.card}>
      <div className="flex items-center gap-4">
        {user.avatar_url ? (
          <img className="size-16 flex-none rounded-full object-cover" src={user.avatar_url} alt="" referrerPolicy="no-referrer" />
        ) : (
          <div className="grid size-16 flex-none place-items-center rounded-full bg-accent text-2xl text-white">
            {fullName[0]?.toUpperCase()}
          </div>
        )}
        <div>
          <h1 className={ui.title}>{fullName}</h1>
          <p className="text-muted">
            @{user.username}
            {user.email && ` · ${user.email}`}
          </p>
        </div>
      </div>

      <h2 className={ui.heading}>Sign-in methods</h2>
      <ul>
        {user.email && (
          <li className="flex flex-wrap items-center gap-3 border-t border-line py-3 [&>:last-child]:ml-auto">
            <span className="min-w-20 font-medium">Password</span>
            <span className={user.has_password ? ui.badge : ui.badgeMuted}>{user.has_password ? "Set" : "Not set"}</span>
            <Link className={ui.link} to="/forgot-password" state={{ email: user.email, from: { pathname: "/" } }}>
              {user.has_password ? "Change" : "Set password"}
            </Link>
          </li>
        )}
        {PROVIDERS.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 border-t border-line py-3 [&>:last-child]:ml-auto">
            <span className="min-w-20 font-medium">{p.name}</span>
            {linked[p.id] ? (
              <>
                <span className={ui.badge}>Connected</span>
                <button className={ui.linkButton} onClick={() => run(() => disconnect(p.id))}>
                  Disconnect
                </button>
              </>
            ) : (
              <ProviderButton provider={p.id} onSuccess={connect(p.id)} onError={onError} text="continue_with" label="Connect Facebook" />
            )}
          </li>
        ))}
      </ul>

      {error && (
        <p className={cx(ui.error, "mt-4")} role="alert">
          {error}
        </p>
      )}

      <button className={cx(ui.outline, "mt-6")} onClick={logout}>
        Log out
      </button>
    </main>
  );
}
