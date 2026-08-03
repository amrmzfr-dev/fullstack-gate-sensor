const STORAGE_KEY = "gate-sensor-token";
const USERNAME_KEY = "gate-sensor-username";

// Fired when the stored token is cleared (logout, or a 401 from the API) so
// any mounted UI can react without prop-drilling auth state everywhere.
export const AUTH_CHANGED_EVENT = "gate-sensor-auth-changed";

export function getToken(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function getUsername(): string | null {
  return localStorage.getItem(USERNAME_KEY);
}

export function setSession(token: string, username: string): void {
  localStorage.setItem(STORAGE_KEY, token);
  localStorage.setItem(USERNAME_KEY, username);
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(USERNAME_KEY);
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}
