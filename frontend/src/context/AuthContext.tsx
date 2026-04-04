import { createContext, useContext, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { clearStoredToken, getStoredToken, setStoredToken } from "../services/storage";
import type { AuthResponse, RegisterBusinessPayload, User } from "../types";

interface AuthContextValue {
  token: string | null;
  user: User | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  registerBusiness: (payload: RegisterBusinessPayload) => Promise<AuthResponse>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  setSession: (response: AuthResponse) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  function normalizeEffectiveUser(user: User | null) {
    if (!user?.support_context) {
      return user;
    }

    return {
      ...user,
      business_id: user.support_context.business_id,
      business_name: user.support_context.business_name,
      business_slug: user.support_context.business_slug,
      pos_type: user.support_context.pos_type || user.pos_type,
      support_session_id: user.support_context.session_id
    };
  }

  useEffect(() => {
    async function hydrate() {
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const response = await apiRequest<{ user: User }>("/auth/me", { token });
        setUser(normalizeEffectiveUser(response.user));
      } catch {
        clearStoredToken();
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    }

    hydrate();
  }, [token]);

  function normalizeSessionUser(response: AuthResponse) {
    const mergedUser = response.support_context
      ? { ...response.user, support_context: response.support_context, support_session_id: response.support_context.session_id }
      : response.user;
    return normalizeEffectiveUser(mergedUser);
  }

  function applySession(nextToken: string | null, nextUser: User | null) {
    if (nextToken) {
      setStoredToken(nextToken);
    } else {
      clearStoredToken();
    }
    setToken(nextToken);
    setUser(nextUser);
  }

  async function refreshUser() {
    if (!token) {
      setUser(null);
      return;
    }

    const response = await apiRequest<{ user: User }>("/auth/me", { token });
    setUser(normalizeEffectiveUser(response.user));
  }

  async function login(identifier: string, password: string) {
    const response = await apiRequest<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password })
    });

    applySession(response.token, normalizeSessionUser(response));
  }

  async function registerBusiness(payload: RegisterBusinessPayload) {
    const response = await apiRequest<AuthResponse>("/auth/register-business", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    applySession(response.token, normalizeSessionUser(response));
    return response;
  }

  function logout() {
    applySession(null, null);
  }

  return (
    <AuthContext.Provider value={{ token, user, loading, login, registerBusiness, logout, refreshUser, setSession: (response) => applySession(response.token, normalizeSessionUser(response)) }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
