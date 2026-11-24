// Configuração do ESLint no formato novo (ESLint 9 e Next.js 16), com as mesmas regras do antigo .eslintrc.json
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const config = [
  ...nextVitals,
  ...nextTs,
  {
    // Regras do React Compiler que o eslint-config-next 16 passou a ligar; não existiam na
    // configuração anterior (Next.js 14) e ficam desligadas para manter o mesmo conjunto de regras.
    rules: {
      'react-hooks/error-boundaries': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  { ignores: ['.next/**', 'node_modules/**', 'out/**', 'next-env.d.ts'] },
]

export default config
