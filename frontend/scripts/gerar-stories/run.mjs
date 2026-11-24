// scripts/gerar-stories/run.mjs
//
// Gera os exemplos dos stories do Instagram em test-output/stories/ pelo
// mesmo caminho do app (/api/export-story) e confere as travas:
//   1. trava de fonte (scripts/regressao-visual/check-fonts.mjs);
//   2. caixas calculadas dentro da área segura de stories;
//   3. tinta real (diff contra o fundo) só dentro de x = 90..990 e
//      y = 250..1580, ou seja, nada nos 250 px do topo nem nos 340 da base;
//   4. textos dos stories para empresas idênticos aos especificados;
//   5. área da figurinha de link vazia (nenhum pixel desenhado) e a
//      indicação "Toque no link abaixo" logo acima dela.
// Monta também prancha-stories-v3.png (máximo 1500 px e 2 MB).
//
// Uso (com o dev server rodando): node scripts/gerar-stories/run.mjs [--base http://localhost:3010]

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const argBase = process.argv.indexOf('--base')
const BASE_URL = argBase > -1 ? process.argv[argBase + 1] : 'http://localhost:3010'
const OUT = path.join(ROOT, 'test-output', 'stories')
const SAFE = { left: 90, right: 990, top: 250, bottom: 1580 }
const INK_THRESHOLD = 24
// Área da figurinha de link (lib/storyLayout.ts, LINK_RESERVE): 560x112 centrada, y = 1444..1556
const RESERVA = { x0: 260, x1: 820, y0: 1444, y1: 1556 }
const MAX_PX = 1500
const MAX_BYTES = 2 * 1024 * 1024

const EMPRESA = [
  ['Sua empresa também pode publicar vagas aqui, de graça.', 'As vagas ficam no Mural de Vagas da Capital Humano Intelligence, abertas para quem procura trabalho na cidade.'],
  ['Tem vaga aberta?', 'Publique no Mural de Vagas da Capital Humano Intelligence sem custo e receba as candidaturas num só lugar.'],
  ['As vagas que você vê aqui todos os dias chegam pelo nosso Mural de Vagas.', 'Capital Humano Intelligence. A da sua empresa pode ser a próxima.'],
]

async function gerar(pedido, extra = {}) {
  const res = await fetch(`${BASE_URL}/api/export-story`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...pedido, ...extra }),
  })
  if (!res.ok) throw new Error(`${res.status}: ${(await res.json().catch(() => ({}))).error || 'erro'}`)
  const h = res.headers.get('x-story-layout')
  return { buf: Buffer.from(await res.arrayBuffer()), info: h ? JSON.parse(decodeURIComponent(h)) : null }
}

async function tintaFora(fullBuf, fundoBuf, imagem = null) {
  const a = await sharp(fullBuf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const b = await sharp(fundoBuf).removeAlpha().raw().toBuffer()
  const { width, height, channels } = a.info
  let fora = 0, reserva = 0, minY = height, maxY = -1, minX = width, maxX = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels
      const d = Math.max(Math.abs(a.data[i] - b[i]), Math.abs(a.data[i + 1] - b[i + 1]), Math.abs(a.data[i + 2] - b[i + 2]))
      if (d <= INK_THRESHOLD) continue
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      const naImagem = imagem && x >= imagem.x && x < imagem.x + imagem.w && y >= imagem.y && y < imagem.y + imagem.h
      if (!naImagem && (x < SAFE.left || x >= SAFE.right || y < SAFE.top || y >= SAFE.bottom)) fora++
      if (naImagem && (y < SAFE.top || y >= SAFE.bottom)) fora++
      if (x >= RESERVA.x0 && x < RESERVA.x1 && y >= RESERVA.y0 && y < RESERVA.y1) reserva++
    }
  }
  return { fora, reserva, caixa: { minX, minY, maxX, maxY }, width, height }
}

const textos = (layout, role) => layout.items.filter(i => i.kind === 'text' && (!role || i.role === role)).map(i => i.lines.map(l => l.text).join(' '))

async function main() {
  const lock = spawnSync(process.execPath, [path.join(ROOT, 'scripts/regressao-visual/check-fonts.mjs')], { encoding: 'utf8' })
  if (lock.status !== 0) { console.error(lock.stdout, lock.stderr); throw new Error('Trava de fonte falhou.') }
  console.log('Trava de fonte: OK')
  mkdirSync(OUT, { recursive: true })

  const casos = [
    ...[1, 2, 3].map(m => ({ arquivo: `empresa-${m}.png`, rotulo: `Para empresas ${m}`, pedido: { tipo: 'empresa', modelo: m } })),
    { arquivo: 'capa-vagas.png', rotulo: 'Capa: Vagas', pedido: { tipo: 'capa', icone: 'vagas' }, capa: true },
    { arquivo: 'capa-empresas.png', rotulo: 'Capa: Para empresas', pedido: { tipo: 'capa', icone: 'empresas' }, capa: true },
  ]

  const falhas = []
  for (const c of casos) {
    const full = await gerar(c.pedido, { _debug: true })
    const fundo = await gerar(c.pedido, { _soFundo: true })
    const L = full.info.layout
    const t = await tintaFora(full.buf, fundo.buf, null)
    const probs = [...full.info.problems]
    if (t.width !== 1080 || t.height !== 1920) probs.push(`tamanho ${t.width}x${t.height}`)
    if (t.fora > 0) probs.push(`${t.fora} px de tinta fora da área segura (caixa y=${t.caixa.minY}..${t.caixa.maxY})`)
    if (c.pedido.tipo === 'empresa') {
      const [tit, apoio] = EMPRESA[c.pedido.modelo - 1]
      const [rt] = textos(L, 'headline'), [ra] = textos(L, 'support')
      if (rt !== tit) probs.push(`título desenhado difere: "${rt}"`)
      if (ra !== apoio) probs.push(`apoio desenhado difere: "${ra}"`)
    }
    if (c.pedido.tipo === 'empresa') {
      // Área da figurinha de link: nenhum elemento (nenhum pixel diferente do fundo).
      if (t.reserva > 0) probs.push(`${t.reserva} px desenhados na área da figurinha de link`)
      const dicas = textos(L).filter(x => x === 'Toque no link abaixo')
      if (dicas.length !== 1) probs.push('indicação "Toque no link abaixo" ausente')
      if (L.items.some(i => i.kind === 'link')) probs.push('ainda existe botão de link desenhado')
    }
    writeFileSync(path.join(OUT, c.arquivo), full.buf)
    c.buf = full.buf
    console.log(`${c.arquivo.padEnd(28)} tinta y=${t.caixa.minY}..${t.caixa.maxY}  ${probs.length ? 'MARCADO' : 'ok'}`)
    for (const p of probs) falhas.push(`${c.arquivo}: ${p}`)
  }

  // Prancha geral: empresas (em cima) e capas + círculo do perfil (embaixo).
  const geral = casos
  const M = 24, G = 14, LH = 30
  const cols = 5
  const tw = Math.floor((MAX_PX - 2 * M - (cols - 1) * G) / cols)
  const th = Math.round(tw * 1920 / 1080)
  const comps = []
  const label = (txt, w) => Buffer.from(`<svg width="${w}" height="${LH}" xmlns="http://www.w3.org/2000/svg"><text x="0" y="21" font-family="Georgia, serif" font-weight="bold" font-size="17" fill="#1F1F1D">${txt}</text></svg>`)
  geral.forEach((c, i) => { const slot = c.capa ? cols + i - 3 : i; c.x = M + (slot % cols) * (tw + G); c.y = M + Math.floor(slot / cols) * (th + LH + G) })
  for (const c of geral) {
    comps.push({ input: label(c.rotulo, tw), left: c.x, top: c.y })
    comps.push({ input: await sharp(c.buf).resize(tw, th).png().toBuffer(), left: c.x, top: c.y + LH })
  }
  // círculos de destaque (64 e 110 px), ao lado das capas
  const capas = geral.filter(c => c.capa)
  const cx0 = M + 2 * (tw + G), cy0 = capas[0].y
  comps.push({ input: label('Como as capas aparecem no perfil', 2 * tw), left: cx0, top: cy0 })
  let x = cx0
  for (const c of capas) {
    for (const d of [110, 64]) {
      const sq = await sharp(c.buf).extract({ left: 0, top: 420, width: 1080, height: 1080 }).resize(d, d).png().toBuffer()
      const mask = Buffer.from(`<svg width="${d}" height="${d}"><circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="#fff"/></svg>`)
      const circ = await sharp(sq).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
      comps.push({ input: circ, left: x, top: cy0 + LH + 10 + (110 - d) / 2 })
      x += d + 24
    }
    x += 30
  }
  const H = M * 2 + 2 * (th + LH) + G
  let pr = await sharp({ create: { width: MAX_PX, height: H, channels: 3, background: '#F3EEE3' } }).composite(comps).png().toBuffer()
  if (pr.length > MAX_BYTES) pr = await sharp(pr).png({ palette: true }).toBuffer()
  writeFileSync(path.join(OUT, 'prancha-stories-v3.png'), pr)
  const meta = await sharp(pr).metadata()
  const prOk = meta.width <= MAX_PX && meta.height <= MAX_PX && pr.length <= MAX_BYTES
  console.log(`prancha-stories-v3.png ${meta.width}x${meta.height} ${(pr.length / 1024).toFixed(0)} KB ${prOk ? 'OK' : 'EXCEDE'}`)

  if (falhas.length || !prOk) {
    console.error(`\n!!! ${falhas.length} problema(s) !!!`)
    for (const f of falhas) console.error('  - ' + f)
    process.exit(1)
  }
  console.log('\nTodas as travas passaram.')
}

main().catch(e => { console.error(e.message || e); process.exit(1) })
