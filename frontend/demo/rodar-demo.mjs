// npm run demo: sobe a API de exemplo e o next dev juntos, com NEXT_PUBLIC_DEMO=1.
// Ctrl+C (ou o fim de qualquer um dos dois) encerra os dois.
// Portas: DEMO_PORTA_WEB (padrão 3210) e DEMO_PORTA_API (padrão 8710).

import { spawn, execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { iniciarApiDemo, PORTA_API_PADRAO } from './api-demo.mjs'

const FRONT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORTA_API = Number(process.env.DEMO_PORTA_API || PORTA_API_PADRAO)
const PORTA_WEB = Number(process.env.DEMO_PORTA_WEB || 3210)

let api
try {
  api = await iniciarApiDemo(PORTA_API)
} catch (e) {
  console.error(`Não foi possível abrir a API de exemplo na porta ${PORTA_API} (${e.code || e.message}). Escolha outra com DEMO_PORTA_API.`)
  process.exit(1)
}

const next = spawn(process.execPath, [path.join(FRONT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', String(PORTA_WEB), '-H', '127.0.0.1'], {
  cwd: FRONT,
  stdio: 'inherit',
  env: {
    ...process.env,
    NEXT_PUBLIC_DEMO: '1',
    NEXT_PUBLIC_DEMO_API_URL: `http://127.0.0.1:${PORTA_API}`,
    NEXT_TELEMETRY_DISABLED: '1',
  },
})

console.log(`\nDemonstração: abra http://127.0.0.1:${PORTA_WEB} (dados fictícios, sem senha). Ctrl+C encerra.\n`)

let encerrando = false
function encerrar(codigo = 0) {
  if (encerrando) return
  encerrando = true
  try {
    if (process.platform === 'win32') execSync(`taskkill /PID ${next.pid} /T /F`, { stdio: 'ignore' })
    else next.kill('SIGTERM')
  } catch { /* já tinha saído */ }
  api.close(() => process.exit(codigo))
  setTimeout(() => process.exit(codigo), 2000).unref()
}

next.on('exit', c => encerrar(c ?? 0))
process.on('SIGINT', () => encerrar(0))
process.on('SIGTERM', () => encerrar(0))
