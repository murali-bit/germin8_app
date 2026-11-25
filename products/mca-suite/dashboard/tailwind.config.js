/** @type {import('tailwindcss').Config} */

// Germin8 light theme: white surfaces, warm page background, gold accent.
// THEME TOKENS (shared contract): gold-*, ink / ink-muted / ink-subtle, page, surface, line / line-strong.
const gold = {
  50: '#FBF7EC',
  100: '#F6ECCF',
  200: '#EDDA9F',
  300: '#E2C26B',
  400: '#D4A944',
  500: '#C29431',
  600: '#A67A24',
  700: '#85611E',
  800: '#634819',
  900: '#463313',
}

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      colors: {
        gold,
        // Legacy name kept so older class names land on the same accent.
        primary: gold,
        ink: {
          DEFAULT: '#1F2433',
          muted: '#5F6577',
          subtle: '#6E7383',
        },
        page: '#F8F6F1',
        surface: '#FFFFFF',
        line: {
          DEFAULT: '#ECE7DB',
          strong: '#DDD5C3',
          // Form-control borders: 3:1 against white (WCAG 1.4.11); card dividers keep the lighter line.
          input: '#948B78',
        },
      },
      // A bare `border` / `ring` utility picks up the theme's thin warm line / gold ring.
      borderColor: {
        DEFAULT: '#ECE7DB',
      },
      ringColor: {
        DEFAULT: '#E2C26B',
      },
      boxShadow: {
        card: '0 1px 2px rgba(31,36,51,0.04), 0 4px 16px rgba(31,36,51,0.04)',
        'card-hover': '0 2px 6px rgba(31,36,51,0.06), 0 12px 28px rgba(31,36,51,0.06)',
        pop: '0 12px 40px rgba(31,36,51,0.12), 0 2px 6px rgba(31,36,51,0.06)',
        // Legacy names (no glass effect any more, just soft shadows).
        glass: '0 1px 2px rgba(31,36,51,0.04), 0 4px 16px rgba(31,36,51,0.04)',
        'glass-lg': '0 8px 28px rgba(31,36,51,0.08)',
        'glass-xl': '0 12px 40px rgba(31,36,51,0.12), 0 2px 6px rgba(31,36,51,0.06)',
      },
      animation: {
        'fade-up': 'fadeUp 0.4s ease-out forwards',
        'fade-in': 'fadeIn 0.3s ease-out forwards',
        'slide-in-right': 'slideInRight 0.3s ease-out forwards',
        'pulse-soft': 'pulseSoft 3s ease-in-out infinite',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(24px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
    },
  },
  plugins: [],
}
