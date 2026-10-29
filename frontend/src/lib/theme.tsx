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
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#09100d' : '#f4f6f4');
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
  grid: '#23362e',
  axis: '#93aa9e',
  tooltipBg: '#101d18',
  tooltipBorder: '#2b4439',
  tooltipLabel: '#f3f8f5',
  accent: '#3ecf96',
  green: '#34d399',
  secondary: '#e8ae3e',
  energy: '#e8ae3e',
  warn: '#f5b84b',
  danger: '#fb7185',
};

const CHART_LIGHT: ChartPalette = {
  grid: '#dfe7e2',
  axis: '#52685e',
  tooltipBg: '#ffffff',
  tooltipBorder: '#d6e0da',
  tooltipLabel: '#0f1f18',
  accent: '#126b49',
  green: '#108a56',
  secondary: '#c9891e',
  energy: '#c9891e',
  warn: '#ba6c10',
  danger: '#c21d44',
};

export function useChartPalette(): ChartPalette {
  const { theme } = useTheme();
  return theme === 'light' ? CHART_LIGHT : CHART_DARK;
}
