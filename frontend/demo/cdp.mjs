// Mini cliente do Chrome DevTools Protocol para os prints da demonstração.
// Abre um Chrome headless próprio, com perfil temporário apagado no fim, na
// porta DEMO_PORTA_CHROME (padrão 9444). Só módulos nativos do Node (20 ou mais novo, com WebSocket).

import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CANDIDATOS = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

const esperar = ms => new Promise(r => setTimeout(r, ms))

export async function abrirChrome({ porta = Number(process.env.DEMO_PORTA_CHROME || 9444) } = {}) {
  const exe = CANDIDATOS.find(c => fs.existsSync(c))
  if (!exe) throw new Error('Chrome não encontrado. Informe o caminho na variável CHROME.')
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'pbs-demo-chrome-'))
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--lang=pt-BR', 'about:blank'], { stdio: 'ignore' })

  let ws
  for (let i = 0; i < 100 && !ws; i++) {
    try {
      const lista = await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json()
      const pg = lista.find(t => t.type === 'page')
      if (pg) ws = new WebSocket(pg.webSocketDebuggerUrl)
    } catch { /* ainda subindo */ }
    if (!ws) await esperar(200)
  }
  if (!ws) throw new Error(`Chrome não respondeu na porta ${porta}.`)
  await new Promise(r => { ws.onopen = r })

  let id = 0
  const pendentes = new Map()
  const ouvintes = []
  ws.onmessage = m => {
    const d = JSON.parse(m.data)
    if (d.id && pendentes.has(d.id)) {
      const p = pendentes.get(d.id); pendentes.delete(d.id)
      d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result)
    } else if (d.method) ouvintes.forEach(o => o(d))
  }
  const send = (method, params = {}, prazo = 30000) => new Promise((res, rej) => {
    const i = ++id
    const t = setTimeout(() => { if (pendentes.delete(i)) rej(new Error(`tempo esgotado em ${method}`)) }, prazo)
    pendentes.set(i, { res: v => { clearTimeout(t); res(v) }, rej: e => { clearTimeout(t); rej(e) } })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')

  // Erros do console e exceções da página, para conferir as telas.
  const erros = []
  ouvintes.push(d => {
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error')
      erros.push(d.params.args.map(a => a.value ?? a.description ?? '').join(' '))
    if (d.method === 'Runtime.exceptionThrown')
      erros.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text)
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error')
      erros.push(`${d.params.entry.text} ${d.params.entry.url || ''}`.trim())
  })

  const chrome = {
    send,
    erros,
    async abrir(url, largura, altura) {
      await send('Emulation.setDeviceMetricsOverride', { width: largura, height: altura, deviceScaleFactor: 1, mobile: largura < 768 })
      await send('Emulation.setTouchEmulationEnabled', { enabled: largura < 768 })
      let o
      const carregou = new Promise(r => { o = d => { if (d.method === 'Page.loadEventFired') r() }; ouvintes.push(o) })
      await send('Page.navigate', { url })
      await Promise.race([carregou, esperar(20000)])
      ouvintes.splice(ouvintes.indexOf(o), 1)
      await Promise.race([chrome.avaliar('document.fonts ? document.fonts.ready.then(() => 1) : 1'), esperar(5000)])
    },
    async avaliar(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 20000 })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
      return r.result.value
    },
    async print(arquivo) {
      const r = await send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(arquivo, Buffer.from(r.data, 'base64'))
    },
    fechar() {
      try { ws.close() } catch { /* já fechado */ }
      try {
        if (process.platform === 'win32') execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' })
        else proc.kill()
      } catch { /* já tinha saído */ }
      for (let i = 0; i < 10; i++) {
        try { fs.rmSync(perfil, { recursive: true, force: true }); break } catch { execSync(process.platform === 'win32' ? 'ping -n 2 127.0.0.1' : 'sleep 1', { stdio: 'ignore' }) }
      }
    },
  }
  return chrome
}
