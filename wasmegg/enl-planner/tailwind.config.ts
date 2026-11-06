import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';
import forms from '@tailwindcss/forms';

export default {
  content: ['./index.html', './src/**/*.{vue,ts}', '../../ui/**/*.vue'],
  safelist: ['h-4', 'w-4', 'h-5', 'w-5', 'h-6', 'w-6'],
  theme: {
    extend: {
      colors: {
        green: colors.emerald,
        yellow: colors.amber,
        purple: colors.violet,
        brand: {
          primary: 'var(--color-brand-primary)',
          secondary: 'var(--color-brand-secondary)',
          tertiary: 'var(--color-brand-tertiary)',
        }
      },
    },
  },
  plugins: [forms],
} satisfies Config;
