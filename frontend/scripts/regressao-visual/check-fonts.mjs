// scripts/regressao-visual/check-fonts.mjs
//
// Trava de fonte faltante. Lê as fontes registradas no ImageResponse (lista
// única em lib/ogServer.ts) e as combinações fontFamily+fontWeight+
// fontStyle usadas pelos templates dos cards e dos stories (lib/cardLayout.ts,
// components/cardTemplates.tsx, lib/storyLayout.ts,
// components/storyTemplates.tsx), e falha com erro explícito se alguma
// combinação não tiver arquivo carregado -- o tipo de gap que já causou peso
// sintetizado sem ninguém perceber. Também confere que o arquivo usado pra
// MEDIR cada papel de texto (campo `file` de TEXT_ROLES) é o mesmo arquivo
// registrado pra DESENHAR aquela combinação; se divergirem, o título seria
// medido com uma fonte e desenhado com outra. Roda no início de run.mjs e
// standalone: `node scripts/regressao-visual/check-fonts.mjs`.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
// Lista única de fontes do ImageResponse (usada por /api/export-card e
// /api/export-story) e todos os templates que desenham texto.
const ROUTE_FILE = path.join(ROOT, 'lib', 'ogServer.ts')
const TEMPLATE_FILES = [
  path.join(ROOT, 'lib', 'cardLayout.ts'),
  path.join(ROOT, 'components', 'cardTemplates.tsx'),
  path.join(ROOT, 'lib', 'storyLayout.ts'),
  path.join(ROOT, 'components', 'storyTemplates.tsx'),
]

// Extrai o conteúdo do objeto de estilo que contém `fontFamily:` -- acha o
// `{` que abre esse objeto (balanceando chaves pra trás) e o `}` que fecha
// (balanceando pra frente), pra funcionar com objeto de estilo em uma ou
// várias linhas, sem depender de formatação específica.
function extractStyleObject(src, fontFamilyIndex) {
  let depth = 0
  let start = -1
  for (let i = fontFamilyIndex; i >= 0; i--) {
    if (src[i] === '}') depth++
    else if (src[i] === '{') {
      if (depth === 0) { start = i; break }
      depth--
    }
  }
  if (start === -1) return null

  depth = 0
  let end = -1
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  if (end === -1) return null

  return src.slice(start, end + 1)
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length
}

export function checkFontLocks({ throwOnMismatch = true } = {}) {
  const src = readFileSync(ROUTE_FILE, 'utf8')

  // --- 1. Fontes carregadas: mapeia variável -> arquivo (loadLocalFont) ---
  const varToFile = {}
  const loadRe = /const\s*\[([^\]]+)\]\s*=\s*await\s*Promise\.all\(\[([\s\S]*?)\]\)/
  const loadMatch = src.match(loadRe)
  if (!loadMatch) throw new Error('Não achei o bloco loadAllFonts() com Promise.all -- verifique se lib/ogServer.ts mudou de estrutura.')
  const varNames = loadMatch[1].split(',').map(s => s.trim()).filter(Boolean)
  const fileCalls = [...loadMatch[2].matchAll(/loadLocalFont\(requestUrl,\s*'([^']+)'\)/g)].map(m => m[1])
  if (varNames.length !== fileCalls.length) {
    throw new Error(`Descompasso entre variáveis (${varNames.length}) e chamadas loadLocalFont (${fileCalls.length}) em loadAllFonts().`)
  }
  varNames.forEach((v, i) => { varToFile[v] = fileCalls[i] })

  // --- 2. Fontes registradas no ImageResponse: name + weight + style + variável de dado ---
  const fontsArrayRe = /export function imageFonts[\s\S]*?return \[([\s\S]*?)\]\s*as const/
  const fontsArrayMatch = src.match(fontsArrayRe)
  if (!fontsArrayMatch) throw new Error('Não achei a lista de imageFonts() em lib/ogServer.ts.')
  const entryRe = /\{\s*name:\s*'([^']+)',\s*data:\s*fonts\.(\w+),\s*weight:\s*(\d+),\s*style:\s*'([^']+)'/g
  const loaded = []
  let em
  while ((em = entryRe.exec(fontsArrayMatch[1])) !== null) {
    const [, name, dataVar, weight, style] = em
    loaded.push({ family: name, weight: Number(weight), style, file: varToFile[dataVar] || `(variável '${dataVar}' não encontrada em loadAllFonts)` })
  }
  if (loaded.length === 0) throw new Error('Array `fonts:` encontrado mas nenhuma entrada foi parseada -- verifique o formato.')

  // --- 3. Combinações realmente usadas nos templates (fontFamily nos estilos) ---
  const used = []
  for (const file of TEMPLATE_FILES) {
    const tsrc = readFileSync(file, 'utf8')
    const ffRe = /fontFamily:\s*'([^']+)'/g
    let fm
    while ((fm = ffRe.exec(tsrc)) !== null) {
      const styleObj = extractStyleObject(tsrc, fm.index)
      if (!styleObj) continue
      const family = fm[1]
      const weightMatch = styleObj.match(/fontWeight:\s*(\d+)/)
      const styleMatch = styleObj.match(/fontStyle:\s*'([^']+)'/)
      const measureMatch = styleObj.match(/file:\s*'([^']+)'/)
      const weight = weightMatch ? Number(weightMatch[1]) : 400 // default CSS
      const style = styleMatch ? styleMatch[1] : 'normal'       // default CSS
      used.push({
        family, weight, style, measureFile: measureMatch ? measureMatch[1] : null,
        where: `${path.relative(ROOT, file).replace(/\\/g, '/')}:${lineOf(tsrc, fm.index)}`,
      })
    }
  }

  // --- 4. Compara ---
  const results = used.map(u => {
    const match = loaded.find(l => l.family === u.family && l.weight === u.weight && l.style === u.style)
    return { ...u, file: match ? match.file : null }
  })

  const missing = results.filter(r => !r.file)
  const measureMismatch = results.filter(r => r.file && r.measureFile && r.measureFile !== r.file)

  return { loaded, used: results, missing, measureMismatch }
}

function main() {
  const { loaded, used, missing, measureMismatch } = checkFontLocks()

  console.log('=== Fontes carregadas (loadAllFonts / ImageResponse fonts:) ===')
  for (const l of loaded) {
    console.log(`  ${l.family} ${l.weight} ${l.style}  ->  ${l.file}`)
  }

  console.log('\n=== Combinações usadas nos templates (fontFamily+fontWeight+fontStyle) ===')
  for (const u of used) {
    const status = u.file ? `OK -> ${u.file}` : '!!! SEM ARQUIVO CARREGADO'
    const measure = u.measureFile ? `  (mede com ${u.measureFile})` : ''
    console.log(`  ${u.where}  ${u.family} ${u.weight} ${u.style}  ${status}${measure}`)
  }

  if (missing.length > 0) {
    console.error(`\nFALHA: ${missing.length} combinação(ões) usada(s) no template sem fonte carregada:`)
    for (const m of missing) {
      console.error(`  - ${m.where} -> ${m.family} peso ${m.weight} estilo ${m.style}`)
    }
    console.error('\nO Satori vai sintetizar/aproximar essas combinações sem avisar -- adicione o peso/estilo')
    console.error('faltante em loadAllFonts() e no array `fonts:` do ImageResponse, ou ajuste o template.')
    process.exitCode = 1
  }
  if (measureMismatch.length > 0) {
    console.error(`\nFALHA: ${measureMismatch.length} papel(is) medido(s) com um arquivo e desenhado(s) com outro:`)
    for (const m of measureMismatch) {
      console.error(`  - ${m.where} -> mede com ${m.measureFile}, desenha com ${m.file}`)
    }
    process.exitCode = 1
  }
  if (!missing.length && !measureMismatch.length) {
    console.log(`\nOK: todas as ${used.length} combinações usadas têm arquivo carregado, e medição = desenho em todos os papéis.`)
  }
}

// Só roda main() quando chamado diretamente (`node check-fonts.mjs`), não quando importado por run.mjs
const isDirectRun = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
if (isDirectRun) {
  main()
}
