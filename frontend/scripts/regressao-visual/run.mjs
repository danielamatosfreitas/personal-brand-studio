#!/usr/bin/env node
// scripts/regressao-visual/run.mjs
//
// Protocolo de verificação visual reutilizável (toda rodada visual daqui pra
// frente termina com isto). Requer:
//   1. O dev server rodando em localhost:3010 (`npm run dev -- -p 3010`)
//   2. Microsoft Edge instalado (usa --headless=new pra renderizar o lado
//      cliente via app/dev-preview-slide/, sem precisar de Puppeteer/Playwright)
//   3. `npm install` já rodado (usa `sharp`, devDependency do projeto)
//
// Uso: node scripts/regressao-visual/run.mjs
//
// Gera, pra cada família/variante em uso, um card pelo lado CLIENTE
// (screenshot real do componente React de preview) e um pelo lado SERVIDOR
// (PNG real de /api/export-card), com a mesma string de teste (ver
// cases.mjs). Salva os PNGs individuais, monta duas pranchas comparativas
// (visão geral + recortes ampliados) e imprime contagem de linhas de
// título/corpo dos dois lados -- IMPORTANTE: a ferramenta NÃO declara nada
// "limpo" sozinha. Quem rodar o script precisa olhar a prancha de recortes
// ampliados e confirmar visualmente antes de reportar.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { CASES, TEST_STRING } from './cases.mjs'
import { checkFontLocks } from './check-fonts.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const OUT_DIR = path.join(PROJECT_ROOT, 'test-output', 'cards')
const BASE_URL = 'http://localhost:3010'
const EDGE_PATHS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

const CARD_PX = 1080
const BOARD_CARD_PX = 540 // largura de cada card na prancha principal
const LABEL_H = 40
const COL_GAP = 30
const ROW_GAP = 16
const PAD = 30

function timestamp() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

function findEdge() {
  for (const p of EDGE_PATHS) if (existsSync(p)) return p
  throw new Error('Microsoft Edge não encontrado nos caminhos esperados. Ajuste EDGE_PATHS em run.mjs.')
}

async function checkServerUp() {
  try {
    const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(3000) })
    return res.ok || res.status < 500
  } catch {
    return false
  }
}

async function renderServer(testCase) {
  const body = {
    slide: {
      index: testCase.index,
      total: testCase.total,
      isCover: testCase.isCover,
      title: TEST_STRING,
      body: TEST_STRING,
      ...(testCase.label ? { label: testCase.label } : {}),
    },
    variant: testCase.variant,
    family: testCase.family,
    ideiaTone: testCase.ideiaTone,
  }
  const res = await fetch(`${BASE_URL}/api/export-card`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Servidor falhou pra ${testCase.slug}: ${res.status} ${text}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

function buildPreviewUrl(testCase) {
  const qs = new URLSearchParams({
    family: testCase.family,
    variant: testCase.variant,
    ideiaTone: testCase.ideiaTone,
    title: TEST_STRING,
    body: TEST_STRING,
    index: String(testCase.index),
    total: String(testCase.total),
    isCover: testCase.isCover ? '1' : '0',
    ...(testCase.label ? { label: testCase.label } : {}),
  })
  return `${BASE_URL}/dev-preview-slide?${qs.toString()}`
}

function renderClient(testCase, tmpDir, idx) {
  const url = buildPreviewUrl(testCase)
  const outfile = path.join(tmpDir, `client_${testCase.slug}.png`)
  const profileDir = path.join(tmpDir, `edgeprofile_${idx}`)
  const edge = findEdge()

  execFileSync(edge, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1080,1150',
    '--virtual-time-budget=3000',
    `--user-data-dir=${profileDir}`,
    `--screenshot=${outfile}`,
    url,
  ], { stdio: 'ignore', timeout: 30000 })

  if (!existsSync(outfile)) throw new Error(`Screenshot cliente falhou pra ${testCase.slug}`)
  return readFileSync(outfile)
}

// Mede linhas reais no DOM do cliente (Range.getClientRects(), ver
// app/dev-preview-slide/page.tsx) via --dump-dom -- só existe pro lado
// cliente, que roda num DOM real. O lado servidor (Satori) não expõe essa
// informação, então não inventamos uma estimativa equivalente pra ele: quem
// ler o output confere o servidor contra a prancha de recortes ampliados.
function readClientLineCounts(testCase, tmpDir, idx) {
  const url = buildPreviewUrl(testCase)
  const profileDir = path.join(tmpDir, `edgeprofile_dom_${idx}`)
  const edge = findEdge()

  const domHtml = execFileSync(edge, [
    '--headless=new',
    '--disable-gpu',
    '--virtual-time-budget=3000',
    `--user-data-dir=${profileDir}`,
    '--dump-dom',
    url,
  ], { timeout: 30000, maxBuffer: 1024 * 1024 * 20 }).toString('utf8')

  const match = domHtml.match(/<pre id="__line_debug__"[^>]*>(.*?)<\/pre>/s)
  if (!match) return null
  try {
    const blocks = JSON.parse(match[1].replace(/&quot;/g, '"'))
    return blocks.map(b => b.lines)
  } catch {
    return null
  }
}

function svgLabel(text, width, height, opts = {}) {
  const { fontSize = 22, color = '#1F1F1D', align = 'left', weight = 600 } = opts
  const x = align === 'left' ? 8 : width / 2
  const anchor = align === 'left' ? 'start' : 'middle'
  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#F7F5F0"/>
      <text x="${x}" y="${height - 10}" font-family="Georgia, serif" font-size="${fontSize}"
            font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${escapeXml(text)}</text>
    </svg>`)
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function composeMainBoard(rows, outPath) {
  const colW = BOARD_CARD_PX
  const boardW = PAD * 2 + colW * 2 + COL_GAP
  const rowH = LABEL_H + colW + ROW_GAP
  const boardH = PAD * 2 + LABEL_H + rowH * rows.length

  const composites = []
  composites.push({
    input: svgLabel('CLIENTE', colW, LABEL_H, { align: 'left', fontSize: 24 }),
    left: PAD, top: PAD,
  })
  composites.push({
    input: svgLabel('SERVIDOR', colW, LABEL_H, { align: 'left', fontSize: 24 }),
    left: PAD + colW + COL_GAP, top: PAD,
  })

  let y = PAD + LABEL_H
  for (const row of rows) {
    composites.push({
      input: svgLabel(row.rowLabel, boardW - PAD * 2, LABEL_H, { align: 'left', fontSize: 22, weight: 700 }),
      left: PAD, top: y,
    })
    const clientResized = await sharp(row.clientBuf).resize(colW, colW).toBuffer()
    const serverResized = await sharp(row.serverBuf).resize(colW, colW).toBuffer()
    composites.push({ input: clientResized, left: PAD, top: y + LABEL_H })
    composites.push({ input: serverResized, left: PAD + colW + COL_GAP, top: y + LABEL_H })
    y += rowH
  }

  await sharp({ create: { width: boardW, height: boardH, channels: 3, background: '#F7F5F0' } })
    .composite(composites)
    .png()
    .toFile(outPath)
}

// Recorte generoso (título + corpo, ampliado 3x) -- não é cirúrgico por
// palavra. y:130-1030 cobre quase o cartão inteiro (só exclui a faixa da
// marca no topo e a assinatura no rodapé), porque o bloco de texto é
// centralizado verticalmente e sua posição muda com o número de linhas --
// um recorte fixo mais estreito cortava o rodapé do bloco em templates com
// título grande (capa) ou conteúdo mais curto (Ideia). Ajustado em
// 2026-09-23 depois de a prancha anterior cortar o subtítulo da capa.
const CROP = { x: 60, y: 130, w: 960, h: 900 }
const ZOOM = 3

async function composeZoomBoard(rows, outPath) {
  const cropW = CROP.w * ZOOM
  const cropH = CROP.h * ZOOM
  const colW = cropW
  const boardW = PAD * 2 + colW * 2 + COL_GAP
  const rowH = LABEL_H + cropH + ROW_GAP
  const boardH = PAD * 2 + LABEL_H + rowH * rows.length

  const composites = []
  composites.push({ input: svgLabel('CLIENTE (recorte 3x)', colW, LABEL_H, { fontSize: 26 }), left: PAD, top: PAD })
  composites.push({ input: svgLabel('SERVIDOR (recorte 3x)', colW, LABEL_H, { fontSize: 26 }), left: PAD + colW + COL_GAP, top: PAD })

  let y = PAD + LABEL_H
  for (const row of rows) {
    composites.push({
      input: svgLabel(row.rowLabel, boardW - PAD * 2, LABEL_H, { fontSize: 22, weight: 700 }),
      left: PAD, top: y,
    })
    const clientCrop = await sharp(row.clientBuf)
      .extract({ left: CROP.x, top: CROP.y, width: CROP.w, height: CROP.h })
      .resize(cropW, cropH, { kernel: 'lanczos3' })
      .toBuffer()
    const serverCrop = await sharp(row.serverBuf)
      .extract({ left: CROP.x, top: CROP.y, width: CROP.w, height: CROP.h })
      .resize(cropW, cropH, { kernel: 'lanczos3' })
      .toBuffer()
    composites.push({ input: clientCrop, left: PAD, top: y + LABEL_H })
    composites.push({ input: serverCrop, left: PAD + colW + COL_GAP, top: y + LABEL_H })
    y += rowH
  }

  await sharp({ create: { width: boardW, height: boardH, channels: 3, background: '#F7F5F0' } })
    .composite(composites)
    .png()
    .toFile(outPath)
}

async function main() {
  console.log('--- trava de fonte: checando se toda combinação usada tem arquivo carregado ---')
  const { loaded, used, missing } = checkFontLocks()
  for (const u of used) {
    console.log(`  ${u.family} ${u.weight} ${u.style}  ${u.file ? 'OK -> ' + u.file : '!!! SEM ARQUIVO CARREGADO'}`)
  }
  if (missing.length > 0) {
    console.error(`\nERRO: ${missing.length} combinação(ões) de fonte usada(s) no template sem arquivo carregado:`)
    for (const m of missing) console.error(`  - ${m.where} -> ${m.family} peso ${m.weight} estilo ${m.style}`)
    console.error('\nRode `node scripts/regressao-visual/check-fonts.mjs` pra ver o detalhe. Corrija antes de gerar a regressão.\n')
    process.exit(1)
  }
  console.log(`OK: ${used.length} combinações usadas, todas com arquivo carregado (${loaded.length} fontes registradas).\n`)

  if (!(await checkServerUp())) {
    console.error(`\nERRO: servidor não respondeu em ${BASE_URL}.`)
    console.error('Rode antes: npm run dev -- -p 3010\n')
    process.exit(1)
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const tmpDir = path.join(PROJECT_ROOT, '.regressao-visual-tmp')
  mkdirSync(tmpDir, { recursive: true })

  const ts = timestamp()
  const rows = []
  const lineCounts = []

  console.log(`String de teste: "${TEST_STRING}"\n`)

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]
    process.stdout.write(`[${i + 1}/${CASES.length}] ${c.rowLabel} ... `)

    const serverBuf = await renderServer(c)
    const clientBuf = renderClient(c, tmpDir, i)
    const clientLines = readClientLineCounts(c, tmpDir, i)

    const serverIndivPath = path.join(OUT_DIR, `regressao-visual-${c.slug}-server-${ts}.png`)
    const clientIndivPath = path.join(OUT_DIR, `regressao-visual-${c.slug}-client-${ts}.png`)
    writeFileSync(serverIndivPath, serverBuf)
    writeFileSync(clientIndivPath, clientBuf)

    lineCounts.push({ slug: c.slug, rowLabel: c.rowLabel, clientLines })

    rows.push({ rowLabel: c.rowLabel, clientBuf, serverBuf })
    console.log('ok')
  }

  const mainBoardPath = path.join(OUT_DIR, `prancha-regressao-visual-${ts}.png`)
  const zoomBoardPath = path.join(OUT_DIR, `prancha-regressao-visual-zoom-${ts}.png`)
  await composeMainBoard(rows, mainBoardPath)
  await composeZoomBoard(rows, zoomBoardPath)

  rmSync(tmpDir, { recursive: true, force: true })

  console.log('\n--- Contagem de linhas ---')
  console.log('Cliente: medido de verdade no DOM (Range.getClientRects() sobre cada bloco de texto')
  console.log('com flexWrap:wrap -- um retângulo por linha visual real, não estimativa).')
  console.log('Servidor: o Satori não expõe essa medição -- conferir quebra de linha na prancha.\n')
  for (const lc of lineCounts) {
    console.log(`${lc.rowLabel}`)
    if (lc.clientLines) {
      console.log(`  cliente (DOM): ${lc.clientLines.join(', ')} linha(s) por bloco de texto encontrado`)
    } else {
      console.log('  cliente (DOM): não consegui ler a medição -- conferir quebra de linha na prancha.')
    }
    console.log('  servidor: conferir quebra de linha na prancha.')
  }

  console.log(`\nPrancha principal: ${mainBoardPath}`)
  console.log(`Prancha de zoom:   ${zoomBoardPath}`)
  console.log(`\n${CASES.length} arquivos de cada lado (cliente+servidor) salvos em ${OUT_DIR}`)
}

main().catch(err => {
  console.error('\nFALHA:', err.message)
  process.exit(1)
})
