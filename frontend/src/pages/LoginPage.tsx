import { useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Eye, EyeOff, Loader2, Lock } from "lucide-react";

import { HttpError } from "@/lib/api";
import { GK_ACCENT, GK_CARD, GK_HAIR, GK_INK, GK_MONO, GK_SANS } from "@/lib/gatekeepTheme";
import { MOCK_MODE } from "@/lib/mockApi";

interface LoginPageProps {
  onLogin: (username: string, password: string) => Promise<void>;
}

const inputStyle: CSSProperties = {
  width: "100%",
  height: 46,
  borderRadius: 14,
  border: `1px solid ${GK_HAIR}`,
  background: GK_CARD,
  color: "#fff",
  font: `500 14px ${GK_SANS}`,
  padding: "0 14px",
  outline: "none",
  boxSizing: "border-box",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          font: `500 10px/1.4 ${GK_MONO}`, letterSpacing: ".14em", textTransform: "uppercase",
          color: "rgba(255,255,255,.4)",
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

export function LoginPage({ onLogin }: LoginPageProps) {
  // Prefilled only in local mock mode (no real backend) so the delete-log
  // feature — restricted to the "amir" account — is visible without having
  // to type it in every time.
  const [username, setUsername] = useState(MOCK_MODE ? "amir" : "");
  const [password, setPassword] = useState(MOCK_MODE ? "dev" : "");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await onLogin(username, password);
    } catch (err) {
      setError(
        err instanceof HttpError && err.status === 401
          ? "Wrong username or password."
          : "Couldn't reach the server. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100dvh", background: GK_INK, display: "flex", alignItems: "center",
        justifyContent: "center", padding: 24, fontFamily: GK_SANS, boxSizing: "border-box",
      }}
    >
      <div style={{ width: "100%", maxWidth: 340, display: "flex", flexDirection: "column", gap: 26 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          <img src="/logo.png" alt="" style={{ width: 48, height: 48, borderRadius: 10 }} />
          <h1 style={{ margin: 0, font: `800 26px/.95 ${GK_SANS}`, letterSpacing: "-.03em", color: "#fff", textTransform: "uppercase" }}>
            Gate Sensor
          </h1>
          <p style={{ margin: 0, font: `400 11px/1.4 ${GK_MONO}`, letterSpacing: ".04em", color: "rgba(255,255,255,.4)" }}>
            Sign in to view and control the gate
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Username">
            <input
              id="username"
              name="username"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="gk-input"
              style={inputStyle}
            />
          </Field>

          <Field label="Password">
            <div style={{ position: "relative" }}>
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="gk-input"
                style={{ ...inputStyle, paddingRight: 40 }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                style={{
                  position: "absolute", right: 0, top: 0, bottom: 0, width: 40, display: "flex",
                  alignItems: "center", justifyContent: "center", background: "none", border: "none",
                  color: "rgba(255,255,255,.4)", cursor: "pointer",
                }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </Field>

          {error && (
            <span style={{ font: `400 11px ${GK_SANS}`, color: GK_ACCENT }}>{error}</span>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              height: 46, borderRadius: 14, border: "none", cursor: submitting ? "default" : "pointer",
              background: GK_ACCENT, color: GK_INK, font: `800 14px ${GK_SANS}`, letterSpacing: "-.01em",
              textTransform: "uppercase", opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
