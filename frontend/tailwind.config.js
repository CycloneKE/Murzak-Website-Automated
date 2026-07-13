

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
          // Brand palette aligned to the M-monogram (violet -> electric blue gradient).
          // Existing token names are kept so the whole app re-themes without churn.
          navy: '#0E1A40',      // deep indigo-navy (dark panels + dark text)
          blue: '#4F46E5',      // indigo mid-stop
          violet: '#7C3AED',    // gradient start (purple)
          cyan: '#2EA6FF',      // PRIMARY accent (electric blue) — was teal cyan
          electric: '#2EA6FF',  // semantic alias of the accent for new code
          deep: '#050816',      // near-black indigo
          surface: '#0F1633',   // indigo surface
          eggshell: '#F9FAFB',
          gray: '#A7B6C2',
        }
      },
      fontFamily: {
        sans: ['Hanken Grotesk', 'Inter', 'sans-serif'],
        display: ['Bricolage Grotesque', 'Hanken Grotesk', 'sans-serif'],
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
