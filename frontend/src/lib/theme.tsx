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
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#070d0c' : '#f2f6f3');
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

// Recharts paints through SVG attributes, which do not resolve CSS custom
// properties, so chart colours are supplied per theme from here. These hexes are
// the literal values of the matching `--*` tokens in frontend/src/index.css — keep
// the two files in step when the palette changes.
const CHART_DARK: ChartPalette = {
  grid: '#26382f',
  axis: '#8c9e96',
  tooltipBg: '#0f1816',
  tooltipBorder: '#38483f',
  tooltipLabel: '#ecf4f0',
  accent: '#22c598',
  teal: '#2dd4be',
  secondary: '#42b6f0',
  energy: '#faba3e',
  warn: '#fabe3c',
  danger: '#f66e74',
};

const CHART_LIGHT: ChartPalette = {
  grid: '#e2e9e4',
  axis: '#64796f',
  tooltipBg: '#ffffff',
  tooltipBorder: '#cdd8d0',
  tooltipLabel: '#0b1915',
  accent: '#046a54',
  teal: '#0b897a',
  secondary: '#0b659c',
  energy: '#ad540b',
  warn: '#a85a0a',
  danger: '#c1203a',
};

export function useChartPalette(): ChartPalette {
  const { theme } = useTheme();
  return theme === 'light' ? CHART_LIGHT : CHART_DARK;
}
