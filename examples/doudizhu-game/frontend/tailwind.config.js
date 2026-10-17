/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      fontFamily: {
        card: ['Georgia', 'Times New Roman', 'serif'],
      },
      keyframes: {
        'deal-in': {
          '0%': { transform: 'translateY(40px) scale(0.6)', opacity: '0' },
          '100%': { transform: 'translateY(0) scale(1)', opacity: '1' },
        },
        'pop-in': {
          '0%': { transform: 'scale(0.5)', opacity: '0' },
          '70%': { transform: 'scale(1.08)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'stamp': {
          '0%': { transform: 'scale(2.2) rotate(-18deg)', opacity: '0' },
          '60%': { transform: 'scale(1) rotate(-8deg)', opacity: '1' },
          '100%': { transform: 'scale(1) rotate(-8deg)', opacity: '1' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-8px)' },
          '40%': { transform: 'translateX(8px)' },
          '60%': { transform: 'translateX(-5px)' },
          '80%': { transform: 'translateX(5px)' },
        },
        'float-up': {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '20%': { opacity: '1' },
          '100%': { transform: 'translateY(-46px)', opacity: '0' },
        },
        glow: {
          '0%, 100%': { boxShadow: '0 0 12px rgba(250, 204, 21, 0.5)' },
          '50%': { boxShadow: '0 0 26px rgba(250, 204, 21, 0.95)' },
        },
      },
      animation: {
        'deal-in': 'deal-in 0.35s ease-out both',
        'pop-in': 'pop-in 0.28s ease-out both',
        stamp: 'stamp 0.5s cubic-bezier(0.2, 1.4, 0.4, 1) both',
        shake: 'shake 0.45s ease-in-out',
        'float-up': 'float-up 1.4s ease-out both',
        glow: 'glow 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
