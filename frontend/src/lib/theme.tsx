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
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0c0b0a' : '#f6f2ec');
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
  green: string;
  secondary: string;
  energy: string;
  warn: string;
  danger: string;
}

const CHART_DARK: ChartPalette = {
  grid: '#332e28',
  axis: '#b2a89c',
  tooltipBg: '#191613',
  tooltipBorder: '#3a332c',
  tooltipLabel: '#faf6f1',
  accent: '#fb923c',
  green: '#4ade80',
  secondary: '#fbbf24',
  energy: '#fbbf24',
  warn: '#fcd34d',
  danger: '#fb7185',
};

const CHART_LIGHT: ChartPalette = {
  grid: '#e3dcd2',
  axis: '#675e54',
  tooltipBg: '#ffffff',
  tooltipBorder: '#e3dcd2',
  tooltipLabel: '#1a1613',
  accent: '#c2410c',
  green: '#067647',
  secondary: '#b45309',
  energy: '#b45309',
  warn: '#a16207',
  danger: '#be123c',
};

export function useChartPalette(): ChartPalette {
  const { theme } = useTheme();
  return theme === 'light' ? CHART_LIGHT : CHART_DARK;
}
