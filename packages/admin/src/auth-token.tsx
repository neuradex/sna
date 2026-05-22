import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

const storageKey = "sna.admin.authToken";

interface AuthTokenContextValue {
  token: string;
  setToken: (token: string) => void;
  clearToken: () => void;
}

const AuthTokenContext = createContext<AuthTokenContextValue | null>(null);

export function AuthTokenProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState(() => readInitialToken());

  const setToken = useCallback((nextToken: string) => {
    const trimmed = nextToken.trim();
    if (trimmed) localStorage.setItem(storageKey, trimmed);
    else localStorage.removeItem(storageKey);
    setTokenState(trimmed);
  }, []);

  const clearToken = useCallback(() => {
    localStorage.removeItem(storageKey);
    setTokenState("");
  }, []);

  const value = useMemo(() => ({ token, setToken, clearToken }), [clearToken, setToken, token]);
  return <AuthTokenContext.Provider value={value}>{children}</AuthTokenContext.Provider>;
}

export function useAuthToken(): AuthTokenContextValue {
  const value = useContext(AuthTokenContext);
  if (!value) throw new Error("useAuthToken must be used inside AuthTokenProvider");
  return value;
}

function readInitialToken(): string {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const tokenFromUrl = hashParams.get("token") || url.searchParams.get("token");
  if (!tokenFromUrl) return localStorage.getItem(storageKey) || "";

  localStorage.setItem(storageKey, tokenFromUrl);
  hashParams.delete("token");
  url.searchParams.delete("token");
  url.hash = hashParams.toString();
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  return tokenFromUrl;
}
