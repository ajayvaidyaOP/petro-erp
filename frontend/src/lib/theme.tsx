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
    // Paints native widgets (date pickers, selects, scrollbars) to match.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0a101d' : '#f3f6fa');
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
  warn: string;
  danger: string;
}

// Recharts paints through SVG attributes, which do not resolve CSS custom
// properties, so chart colours are supplied per theme from here.
const CHART_DARK: ChartPalette = {
  grid: '#243554',
  axis: '#8fa2c0',
  tooltipBg: '#0f182b',
  tooltipBorder: '#354d77',
  tooltipLabel: '#f1f5f9',
  accent: '#10b981',
  teal: '#14b8a6',
  secondary: '#38bdf8',
  warn: '#fbbf24',
  danger: '#f87171',
};

const CHART_LIGHT: ChartPalette = {
  grid: '#e2e9f2',
  axis: '#64748b',
  tooltipBg: '#ffffff',
  tooltipBorder: '#cfdbe9',
  tooltipLabel: '#0f172a',
  accent: '#058760',
  teal: '#0d9488',
  secondary: '#0369a1',
  warn: '#d97706',
  danger: '#d62436',
};

export function useChartPalette(): ChartPalette {
  const { theme } = useTheme();
  return theme === 'light' ? CHART_LIGHT : CHART_DARK;
}
