import React, { createContext, useContext, useEffect, useState } from "react";
import { User, UserRole } from "../types/frontend.ts";
import { api } from "../services/api.ts";

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAdmin: boolean;
  login: (email: string, password?: string) => Promise<void>;
  register: (payload: { name: string; email: string; password: string; role?: string }) => Promise<void>;
  loginWithGoogle: (payload: {
    email: string;
    name?: string;
    avatarUrl?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
  }) => Promise<void>;
  forgotPassword: (email: string) => Promise<{ message: string }>;
  resetPassword: (payload: { token: string; password: string }) => Promise<{ message: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem("auth_token"));
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshUser = async () => {
    try {
      try {
        const res = await api.getMe();
        setUser(res.user);
        const storedToken = localStorage.getItem("auth_token") || "cookie_authenticated";
        localStorage.setItem("auth_token", storedToken);
        setToken(storedToken);
      } catch {
        // Session expired or missing
        localStorage.removeItem("auth_token");
        localStorage.removeItem("auth_user");
        setUser(null);
        setToken(null);
      }
    } catch (err) {
      console.warn("Auth verify error:", err);
      setUser(null);
      setToken(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  const login = async (email: string, password?: string) => {
    setIsLoading(true);
    try {
      const res = await api.login(email, password);
      localStorage.setItem("auth_token", res.token);
      localStorage.setItem("auth_user", JSON.stringify(res.user));
      setUser(res.user);
      setToken(res.token);
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (payload: { name: string; email: string; password: string; role?: string }) => {
    setIsLoading(true);
    try {
      const res = await api.register(payload);
      localStorage.setItem("auth_token", res.token);
      localStorage.setItem("auth_user", JSON.stringify(res.user));
      setUser(res.user);
      setToken(res.token);
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithGoogle = async (payload: {
    email: string;
    name?: string;
    avatarUrl?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
  }) => {
    setIsLoading(true);
    try {
      const res = await api.googleAuth(payload);
      localStorage.setItem("auth_token", res.token);
      localStorage.setItem("auth_user", JSON.stringify(res.user));
      setUser(res.user);
      setToken(res.token);
    } finally {
      setIsLoading(false);
    }
  };

  const forgotPassword = async (email: string) => {
    return await api.forgotPassword(email);
  };

  const resetPassword = async (payload: { token: string; password: string }) => {
    return await api.resetPassword(payload);
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await api.logout();
      setUser(null);
      setToken(null);
    } finally {
      setIsLoading(false);
    }
  };

  const isAdmin = user?.role === UserRole.ADMIN;

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAdmin,
        login,
        register,
        loginWithGoogle,
        forgotPassword,
        resetPassword,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
