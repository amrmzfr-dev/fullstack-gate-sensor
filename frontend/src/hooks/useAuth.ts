import { useCallback, useEffect, useState } from "react";

import { apiPost } from "@/lib/api";
import {
  AUTH_CHANGED_EVENT,
  clearSession,
  getToken,
  getUsername,
  setSession,
} from "@/lib/auth";
import type { LoginResponse } from "@/types";

export function useAuth() {
  const [token, setToken] = useState<string | null>(() => getToken());
  const [username, setUsername] = useState<string | null>(() => getUsername());

  useEffect(() => {
    const onAuthChanged = () => {
      setToken(getToken());
      setUsername(getUsername());
    };

    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    window.addEventListener("storage", onAuthChanged);

    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
      window.removeEventListener("storage", onAuthChanged);
    };
  }, []);

  const login = useCallback(async (usernameInput: string, password: string) => {
    const response = await apiPost<LoginResponse>("/auth/login", {
      username: usernameInput,
      password,
    });
    setSession(response.token, response.username);
  }, []);

  const logout = useCallback(() => {
    clearSession();
  }, []);

  return {
    isAuthenticated: token !== null,
    username,
    login,
    logout,
  };
}
