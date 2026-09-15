/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#12191C', soft: '#4A565B', faint: '#8A959A' },
        paper: { DEFAULT: '#F6F5F1', raised: '#FFFFFF', sunk: '#EDEBE4' },
        rule: { DEFAULT: '#DEDBD1', strong: '#C6C2B4' },
        brass: { DEFAULT: '#A77B23', deep: '#7E5B13', wash: '#F6EEDC' },
        ledger: { DEFAULT: '#1F6E62', deep: '#155248', wash: '#E4F0ED' },
        brick: { DEFAULT: '#9E3B2E', wash: '#F8E9E6' },
        slate: { 950: '#0E1418', 900: '#141C21', 800: '#1D272D', 700: '#2A363D' },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'SF Pro Text', '-apple-system', 'system-ui', 'sans-serif'],
        serif: ['Iowan Old Style', 'Palatino Linotype', 'Georgia', 'serif'],
        mono: ['SF Mono', 'JetBrains Mono', 'Consolas', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(18,25,28,.04), 0 8px 24px -12px rgba(18,25,28,.18)',
        lift: '0 2px 4px rgba(18,25,28,.05), 0 18px 42px -18px rgba(18,25,28,.32)',
      },
      keyframes: {
        rise: { '0%': { opacity: 0, transform: 'translateY(6px)' }, '100%': { opacity: 1, transform: 'none' } },
        sweep: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(320%)' } },
      },
      animation: { rise: 'rise .28s cubic-bezier(.2,.7,.3,1) both', sweep: 'sweep 1.6s ease-in-out infinite' },
    },
  },
  plugins: [],
};
