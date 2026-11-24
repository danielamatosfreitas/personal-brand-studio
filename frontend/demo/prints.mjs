// Prints da vitrine pelo modo de demonstração: API de exemplo + next dev + Chrome headless próprio.
// Nada aqui fala com o backend real, com o LinkedIn ou com a Meta.
//
// Uso (dentro de frontend/): node demo/prints.mjs [pasta de saída]
// Padrão da saída: capturas/para-revisao na raiz do repositório (fora do Git).

import { spawn, execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { iniciarApiDemo, PORTA_API_PADRAO } from './api-demo.mjs'
import { abrirChrome } from './cdp.mjs'

const FRONT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SAIDA = path.resolve(process.argv[2] || path.join(FRONT, '..', 'capturas', 'para-revisao'))
const PORTA_API = Number(process.env.DEMO_PORTA_API || PORTA_API_PADRAO)
const PORTA_WEB = Number(process.env.DEMO_PORTA_WEB || 3210)
const WEB = `http://127.0.0.1:${PORTA_WEB}`
const esperar = ms => new Promise(r => setTimeout(r, ms))

const CARDS = [
  { arq: 'card-diagnostico-capa.png', body: { slide: { index: 1, total: 3, isCover: true, title: 'Turnover alto raramente é um problema de salário', body: 'O que os desligamentos dizem sobre a sua liderança' }, variant: 'carousel', family: 'diagnostico', ideiaTone: 'verde' } },
  { arq: 'card-alerta.png', body: { slide: { index: 2, total: 3, isCover: false, title: 'Papéis confusos custam caro', body: 'Quando duas pessoas acham que a tarefa é da outra, o cliente espera e a equipe se desgasta.', label: 'PONTO DE ATENÇÃO' }, variant: 'carousel', family: 'alerta', ideiaTone: 'verde' } },
  { arq: 'card-frase.png', body: { slide: { index: 1, total: 1, isCover: true, title: 'Cultura é o que acontece quando ninguém está olhando.', body: '' }, variant: 'quote', family: 'ideia', ideiaTone: 'terracota' } },
]
const TELAS = [
  ['/agendados', 'tela-agendados.png', 1440, 900],
  ['/criar', 'tela-criar.png', 1440, 900],
  ['/agendados', 'tela-agendados-celular.png', 390, 844],
]

fs.mkdirSync(SAIDA, { recursive: true })
const api = await iniciarApiDemo(PORTA_API)
const web = spawn(process.execPath, [path.join(FRONT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', String(PORTA_WEB), '-H', '127.0.0.1'], {
  cwd: FRONT, stdio: 'ignore',
  env: { ...process.env, NEXT_PUBLIC_DEMO: '1', NEXT_PUBLIC_DEMO_API_URL: `http://127.0.0.1:${PORTA_API}`, NEXT_TELEMETRY_DISABLED: '1' },
})
let chrome
try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(WEB)).status < 500) break } catch { /* compilando */ } await esperar(1000) }
  for (const c of CARDS) {
    const r = await fetch(`${WEB}/api/export-card`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c.body) })
    if (!r.ok) throw new Error(`${c.arq}: ${r.status} ${await r.text()}`)
    fs.writeFileSync(path.join(SAIDA, c.arq), Buffer.from(await r.arrayBuffer()))
    console.log('card ok', c.arq)
  }
  chrome = await abrirChrome()
  for (const [rota, arq, largura, altura] of TELAS) {
    await chrome.abrir(WEB + rota, largura, altura)
    await esperar(6000) // primeira compilação da rota no modo dev
    await chrome.abrir(WEB + rota, largura, altura)
    await esperar(2500)
    await chrome.print(path.join(SAIDA, arq))
    console.log('tela ok', arq)
  }
  // As duas imagens usadas na peça visual do portfólio (notebook e celular).
  fs.copyFileSync(path.join(SAIDA, 'tela-agendados.png'), path.join(SAIDA, 'pbs-tela-agendados.png'))
  fs.copyFileSync(path.join(SAIDA, 'card-diagnostico-capa.png'), path.join(SAIDA, 'pbs-card-diagnostico-capa.png'))
  if (chrome.erros.length) console.log('erros no console:', chrome.erros)
} finally {
  if (chrome) chrome.fechar()
  try {
    if (process.platform === 'win32') execSync(`taskkill /PID ${web.pid} /T /F`, { stdio: 'ignore' })
    else web.kill('SIGTERM')
  } catch { /* já tinha saído */ }
  api.close()
}
