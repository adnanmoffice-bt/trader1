import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          void:  '#03030a',
          deep:  '#07070f',
          base:  '#0b0b16',
          raised:'#0f0f1e',
          hover: '#141428',
          card:  '#111122',
        },
        green:  { DEFAULT:'#00ffa3', dim:'rgba(0,255,163,0.08)', bright:'rgba(0,255,163,0.18)' },
        red:    { DEFAULT:'#ff3366', dim:'rgba(255,51,102,0.08)', bright:'rgba(255,51,102,0.18)' },
        amber:  { DEFAULT:'#ffcc00', dim:'rgba(255,204,0,0.08)' },
        blue:   { DEFAULT:'#4d88ff', dim:'rgba(77,136,255,0.08)' },
        cyan:   { DEFAULT:'#00ccff', dim:'rgba(0,204,255,0.08)' },
        purple: { DEFAULT:'#9966ff', dim:'rgba(153,102,255,0.09)' },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'blink':      'blink 2s ease-in-out infinite',
        'slide-in':   'slideIn 0.3s ease-out',
        'ticker-run': 'tickerRun 55s linear infinite',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
      },
      keyframes: {
        blink:     { '0%,100%':{ opacity:'1' }, '50%':{ opacity:'0.25' } },
        slideIn:   { from:{ opacity:'0', transform:'translateY(8px)' }, to:{ opacity:'1', transform:'translateY(0)' } },
        tickerRun: { to:{ transform:'translateX(-50%)' } },
        pulseGlow: { '0%,100%':{ opacity:'1' }, '50%':{ opacity:'0.4' } },
      },
    },
  },
  plugins: [],
}

export default config
