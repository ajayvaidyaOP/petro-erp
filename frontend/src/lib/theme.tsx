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

function systemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Saved choice wins; otherwise follow the OS. */
function initialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === 'light' || saved === 'dark' ? saved : systemTheme();
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    // Paints native widgets (date pickers, selects, scrollbars) to match.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0a0d12' : '#f7f5f1');
  }, [theme]);

  // Keep tracking the OS only while the user has not made an explicit choice.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (event: MediaQueryListEvent) => {
      if (window.localStorage.getItem(STORAGE_KEY)) return;
      setThemeState(event.matches ? 'light' : 'dark');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

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
}

// Recharts paints through SVG attributes, which do not resolve CSS custom
// properties, so chart colours are supplied per theme from here.
const CHART_DARK: ChartPalette = {
  grid: '#2b394c',
  axis: '#9c968f',
  tooltipBg: '#131a24',
  tooltipBorder: '#3b4d66',
  tooltipLabel: '#e4dfd8',
  accent: '#fb923c',
  teal: '#2dd4bf',
};

const CHART_LIGHT: ChartPalette = {
  grid: '#e9e3d6',
  axis: '#7c7063',
  tooltipBg: '#ffffff',
  tooltipBorder: '#d9d0bd',
  tooltipLabel: '#4a4239',
  accent: '#ea580c',
  teal: '#0d9488',
};

export function useChartPalette(): ChartPalette {
  const { theme } = useTheme();
  return theme === 'light' ? CHART_LIGHT : CHART_DARK;
}
