/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        murzak: {
          base: '#F8FAFB',
          surface: '#FFFFFF',
          ink: '#090C10',
          muted: '#4B5270',
          success: '#22C55E',
          warning: '#F59E0B',
          danger: '#EF4444',
          border: '#DFE4F7',
          accent: '#00BDFC',
          brand1: '#882FFD',
          brand2: '#3388F2',
        }
      },
      fontFamily: {
        sans: ['Manrope Variable', 'Manrope', 'sans-serif'],
        mono: ['JetBrains Mono Variable', 'JetBrains Mono', 'monospace'],
      },
      fontSize: {
        // Rem-based type scale — replaces text-[Npx] arbitrary values.
        // 'micro' is the legibility floor; nothing in the app should render smaller.
        'micro':      ['0.6875rem', { lineHeight: '1.35', letterSpacing: '0.08em' }], // 11px
        'label':      ['0.75rem',   { lineHeight: '1.4' }],                            // 12px
        'body-sm':    ['0.8125rem', { lineHeight: '1.5' }],                            // 13px
        'body':       ['0.875rem',  { lineHeight: '1.55' }],                           // 14px
        'body-lg':    ['1rem',      { lineHeight: '1.6' }],                            // 16px
        'title-sm':   ['1.125rem',  { lineHeight: '1.4' }],                            // 18px
        'title':      ['1.25rem',   { lineHeight: '1.35' }],                           // 20px
        'title-lg':   ['1.5rem',    { lineHeight: '1.3' }],                            // 24px
        'display-sm': ['1.875rem',  { lineHeight: '1.2',  letterSpacing: '-0.01em' }],  // 30px
        'display':    ['2.25rem',   { lineHeight: '1.15', letterSpacing: '-0.015em' }], // 36px
        'display-lg': ['3rem',      { lineHeight: '1.1',  letterSpacing: '-0.02em' }],  // 48px
      },
      fontWeight: {
        // Manrope Variable tops out at 800 — remap 'black' so font-black renders
        // a real weight instead of a synthetic/faux-bold 900.
        black: '800',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(to right, #882FFD, #3388F2)',
      },
      boxShadow: {
        'glass': '0 8px 32px 0 rgba(31, 38, 135, 0.05)',
        'glass-dark': '0 8px 32px 0 rgba(0, 0, 0, 0.2)',
      },
      animation: {
        float: 'float 8s ease-in-out infinite',
        drift: 'drift 20s ease-in-out infinite',
        'drift-slow': 'drift 35s ease-in-out infinite alternate',
        'pulse-slow': 'pulse 10s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow-pulse': 'glowPulse 2.5s ease-in-out infinite',
        shimmer: 'shimmer 2s infinite linear',
        'fade-in': 'fadeIn 0.45s ease-out both',
        'fade-in-up': 'fadeInUp 0.6s ease-out both',
        'scale-in': 'scaleIn 0.5s ease-out both',
        'slide-in-right': 'slideInRight 0.5s ease-out both',
        fall: 'fall 2.4s linear infinite',
      },
      keyframes: {
        glowPulse: {
          '0%, 100%': { opacity: '0.4', filter: 'brightness(1)' },
          '50%': { opacity: '1', filter: 'brightness(1.3)' },
        },
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        fall: {
          '0%': { transform: 'translateY(-20px) rotate(0deg)', opacity: '0' },
          '12%': { opacity: '1' },
          '100%': { transform: 'translateY(130px) rotate(240deg)', opacity: '0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0) rotate(0deg)' },
          '50%': { transform: 'translateY(-30px) rotate(5deg)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        drift: {
          '0%': { transform: 'translate(0, 0) scale(1) rotate(0deg)' },
          '33%': { transform: 'translate(80px, -120px) scale(1.2) rotate(15deg)' },
          '66%': { transform: 'translate(-60px, 40px) scale(0.9) rotate(-10deg)' },
          '100%': { transform: 'translate(0, 0) scale(1) rotate(0deg)' },
        }
      }
    }
  },
  plugins: [],
}
