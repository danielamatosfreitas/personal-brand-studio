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
        // Identidade do app (a mesma dos cards): creme, grafite, verde, terracota, dourado.
        // Verde = navegação e áreas de destaque. Terracota = só a ação principal
        // de cada tela. Dourado = só linhas e detalhes finos, nunca texto.
        brand: {
          primary:   '#2C4A3B',
          'primary-dark':  '#223A2E',
          'primary-light': '#3D6350',

          accent:    '#BC5B2E',
          'accent-dark':  '#9F4A22',
          'accent-light': '#CB6E42',

          gold:      '#A9822E',

          background: '#F3EEE3',
          surface:    '#FAF7F0',
          'surface-muted': '#ECE5D6',

          text:       '#1F1F1D',
          'text-muted': '#5C584E',
          'text-light': '#8A8577',

          border:     '#DDD5C4',
          'border-strong': '#C4BAA5',
        },
      },
      fontFamily: {
        // EB Garamond — display/títulos. Cormorant Garamond (2026-09-18) e
        // depois Cormorant, família-base do mesmo projeto (2026-09-23),
        // tinham o glifo do circunflexo (â/ê/ô) com defeito de desenho em
        // tamanho grande de exibição — confirmado com fontTools + 3
        // renderizadores independentes, presente na superfamília inteira.
        // EB Garamond (fundição diferente) confirmado limpo em todos os
        // pesos usados.
        display: ['EB Garamond', 'Georgia', 'serif'],
        // DM Sans — corpo (legível, moderno, como no site)
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        // Mono para código/IDs
        mono: ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        xs: ['0.875rem', { lineHeight: '1.35' }],    // 14 px: legendas e rótulos
        sm: ['0.9375rem', { lineHeight: '1.5' }],    // 15 px: texto de interface
        base: ['1rem', { lineHeight: '1.55' }],      // 16 px
        'display-xl': ['3rem',    { lineHeight: '1.08', letterSpacing: '-0.015em' }], // 48 px: título de página
        'display-lg': ['2.5rem',  { lineHeight: '1.1', letterSpacing: '-0.012em' }],  // 40 px
        'display-md': ['1.75rem', { lineHeight: '1.2', letterSpacing: '-0.005em' }],  // 28 px: título de seção
        'display-sm': ['1.5rem',  { lineHeight: '1.25' }],                            // 24 px
      },
      boxShadow: {
        // Sem sombras pesadas: só um filete de contato quando precisa separar do fundo.
        'brand-sm': 'none',
        'brand-md': 'none',
        'brand-lg': '0 2px 8px rgba(31,31,29,0.10)',
      },
      borderRadius: {
        'brand': '6px',
        'brand-lg': '8px',
        'brand-xl': '8px',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'pulse-soft': 'pulseSoft 2s cubic-bezier(0.4,0,0.6,1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
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

export default config
