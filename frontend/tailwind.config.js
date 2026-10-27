/** @type {import('tailwindcss').Config} */

// Colours resolve through CSS custom properties so both themes share one source
// of truth: toggling `data-theme` on <html> re-tints the entire app without
// touching a single component. Each variable holds space-separated RGB channels,
// which keeps Tailwind's `/opacity` modifiers (e.g. `bg-accent/12`) working.
const channel = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Surface ramp: 950 = page canvas … 600 = strongest border.
        navy: {
          950: channel('--navy-950'),
          900: channel('--navy-900'),
          850: channel('--navy-850'),
          800: channel('--navy-800'),
          750: channel('--navy-750'),
          700: channel('--navy-700'),
          600: channel('--navy-600'),
        },
        // Text ramp: 100 = strongest … 600 = faintest.
        ink: {
          100: channel('--ink-100'),
          200: channel('--ink-200'),
          300: channel('--ink-300'),
          400: channel('--ink-400'),
          500: channel('--ink-500'),
          600: channel('--ink-600'),
        },
        accent: {
          DEFAULT: channel('--accent'),
          soft: channel('--accent-soft'),
          teal: channel('--accent-teal'),
        },
        // Foreground for text sitting on a brand-coloured surface. Deliberately
        // NOT part of the navy ramp: it must stay legible on accent in both
        // themes (near-black on cyan when dark, white on deep blue when light).
        onaccent: channel('--on-accent'),
        // Modal / drawer backdrop. Always dark in both themes — a scrim has to
        // dim the page behind it, so it cannot follow the surface ramp.
        scrim: channel('--scrim'),
        // Recessed surface for code blocks and inset panels: darker than the card
        // when dark, faintly grey when light.
        inset: channel('--inset'),
        // Status colours. Fixed Tailwind shades like `text-emerald-300` read well
        // on a dark card but are unreadable on white, so these invert with the
        // theme (bright 300s when dark, dark 700s when light).
        ok: channel('--ok'),
        warn: channel('--warn'),
        danger: channel('--danger'),
        info: channel('--info'),
      },
      // Extra steps the design uses for tints that the default scale omits
      // (`bg-accent/12` previously generated nothing at all).
      opacity: {
        8: '0.08',
        12: '0.12',
        18: '0.18',
      },
      // `h-9.5` (the default Button size) was referenced but never generated.
      spacing: {
        9.5: '2.375rem',
      },
      fontFamily: {
        sans: [
          'Inter',
          'Inter var',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        focus: 'var(--shadow-focus)',
        pop: 'var(--shadow-pop)',
      },
      borderRadius: {
        '4xl': '1.75rem',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateX(12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'slide-in': 'slide-in 180ms ease-out',
        'scale-in': 'scale-in 140ms ease-out',
        'slide-up': 'slide-up 200ms ease-out',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};
