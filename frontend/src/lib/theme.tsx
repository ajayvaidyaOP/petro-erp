import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'petroflow.theme';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Saved choice wins; light is the default for a readable daytime workspace. */
function initialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === 'light' || saved === 'dark' ? saved : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0a1223' : '#f3f6fc');
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

/* ------------------------------------------------------------------ charts */

export interface ChartPalette {
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipLabel: string;
  accent: string;
  teal: string;
  secondary: string;
  energy: string;
  warn: string;
  danger: string;
}

const CHART_DARK: ChartPalette = {
  grid: '#304464',
  axis: '#a8b9d2',
  tooltipBg: '#142138',
  tooltipBorder: '#304464',
  tooltipLabel: '#f4f8ff',
  accent: '#97b5ff',
  teal: '#5cdacb',
  secondary: '#ffb973',
  energy: '#ffb973',
  warn: '#ffb968',
  danger: '#ff7b8d',
};

const CHART_LIGHT: ChartPalette = {
  grid: '#dae3f0',
  axis: '#5b6f8a',
  tooltipBg: '#ffffff',
  tooltipBorder: '#dae3f0',
  tooltipLabel: '#142442',
  accent: '#2455dd',
  teal: '#0a7f82',
  secondary: '#c35412',
  energy: '#c35412',
  warn: '#b4500d',
  danger: '#c62b41',
};

export function useChartPalette(): ChartPalette {
  const { theme } = useTheme();
  return theme === 'light' ? CHART_LIGHT : CHART_DARK;
}
