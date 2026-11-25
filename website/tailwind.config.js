/** @type {import('tailwindcss').Config} */
import defaultColors from 'tailwindcss/colors';

// Brand palette, from germin8.in:
//   mustard #D4A216 accent. Neutrals are true greys (no blue tint).
// "ink" is a true neutral scale (no blue tint), ending in near-black.
const ink = {
  50: '#FAFAF8',
  100: '#F4F4F2',
  200: '#E7E7E4',
  300: '#D4D4D1',
  400: '#A3A3A0',
  500: '#6E6E6B',
  600: '#525250',
  700: '#3D3D3B',
  800: '#2A2A28',
  900: '#1E1E1C',
  950: '#171716',
};

// Mustard accent. Use 500 for fills, 700 for text on white (AA contrast).
const mustard = {
  50: '#FCF8EC',
  100: '#F8EECF',
  200: '#F0DB9C',
  300: '#E7C665',
  400: '#DDB33A',
  500: '#D4A216',
  600: '#B88A0B',
  700: '#926C0B',
  800: '#6F530E',
  900: '#4D3A0D',
  950: '#2E2207',
};

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Legacy token names used by older pages, now pointing at the brand
        navy: '#171716',
        'blue-primary': '#926C0B',
        'blue-sky': '#E7C665',
        'blue-light': '#FCF8EC',
        'site-bg': '#FFFFFF',
        'text-primary': '#171716',
        'text-secondary': '#6E6E6B',
        paper: '#FAFAF8',
        charcoal: '#171716',
        ink,
        mustard,
        // Accent hues collapse into mustard so no off-brand colour shows
        blue: mustard,
        sky: mustard,
        indigo: mustard,
        violet: mustard,
        purple: mustard,
        cyan: mustard,
        teal: mustard,
        amber: mustard,
        yellow: mustard,
        orange: mustard,
        gray: ink,
        slate: ink,
        // Status colours keep their meaning
        emerald: defaultColors.emerald,
        green: defaultColors.green,
        rose: defaultColors.rose,
        red: defaultColors.red,
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        script: ['Caveat', 'cursive'],
      },
    },
  },
  plugins: [],
};
