import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from './api';

export interface Station {
  id: string;
  name: string;
  code: string;
  status?: string;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  roleKey: string;
  tenantId: string | null;
  tenantName?: string | null;
}

export interface Me {
  user: AuthUser;
  tenant: { id: string; name: string; slug: string; status: string; isDemo: number } | null;
  subscription: {
    status: string;
    planName: string;
    planCode: string;
    trialEndsAt: string | null;
    endsAt: string | null;
    maxStations: number;
    maxUsers: number;
  } | null;
  stations: Station[];
  permissions: string[];
  role: string;
  isSuperAdmin: boolean;
  demoMode: boolean;
}

interface AuthContextValue {
  me: Me | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const meQuery = useQuery<Me>({
    queryKey: ['me'],
    queryFn: () => apiGet<Me>('/auth/me'),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const login = useCallback(
    async (email: string, password: string) => {
      await apiPost('/auth/login', { email, password });
      const me = await queryClient.fetchQuery({ queryKey: ['me'], queryFn: () => apiGet<Me>('/auth/me') });
      return me;
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await apiPost('/auth/logout');
    } finally {
      queryClient.clear();
      window.location.href = '/login';
    }
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(() => {
    const me = meQuery.data ?? null;
    return {
      me,
      isLoading: meQuery.isLoading,
      isAuthenticated: Boolean(me),
      login,
      logout,
      can: (permission: string) => Boolean(me?.permissions.includes(permission) || me?.isSuperAdmin),
      refresh: () => void queryClient.invalidateQueries({ queryKey: ['me'] }),
    };
  }, [meQuery.data, meQuery.isLoading, login, logout, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function useLoginMutation() {
  const { login } = useAuth();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => login(email, password),
  });
}

/* --------------------------------------------------------------- station */
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'petroflow.station';

export function useStations() {
  const { me } = useAuth();
  const stations = useMemo(() => me?.stations ?? [], [me]);
  const [stationId, setStationId] = useState<string>(() => localStorage.getItem(STORAGE_KEY) ?? '');

  useEffect(() => {
    if (stations.length === 0) return;
    if (!stationId || !stations.some((s) => s.id === stationId)) {
      const next = stations[0].id;
      setStationId(next);
      localStorage.setItem(STORAGE_KEY, next);
    }
  }, [stations, stationId]);

  const selectStation = useCallback((id: string) => {
    setStationId(id);
    localStorage.setItem(STORAGE_KEY, id);
    // Station scoping affects nearly every query.
    window.dispatchEvent(new CustomEvent('petroflow:station-changed', { detail: id }));
  }, []);

  const station = stations.find((s) => s.id === stationId) ?? stations[0] ?? null;
  return { stations, station, stationId: station?.id ?? '', selectStation };
}
