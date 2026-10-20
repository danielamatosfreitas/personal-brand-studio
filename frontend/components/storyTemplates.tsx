/**
 * components/storyTemplates.tsx
 *
 * Desenha os stories (1080x1920) a partir das caixas que lib/storyLayout.ts
 * calculou com a fonte real. Renderizado igual pelo servidor (Satori, em
 * app/api/export-story/route.tsx) e pelo preview da página Stories.
 *
 * Restrições do Satori respeitadas: toda div com mais de um filho tem
 * display:flex, e nenhuma propriedade de estilo recebe `undefined` explícito.
 */

import { STORY, STORY_ROLES, type IconName, type StoryColor, type StoryItem, type StoryLayout, type StoryTom } from '../lib/storyLayout'

export const STORY_PALETTES: Record<StoryTom, { bg: string; text: string; muted: string; accent: string }> = {
  verde: { bg: '#2C4A3B', text: '#F3EEE3', muted: 'rgba(243,238,227,0.72)', accent: '#A9822E' },
  terracota: { bg: '#BC5B2E', text: '#F3EEE3', muted: 'rgba(243,238,227,0.80)', accent: '#1F1F1D' },
}

type Palette = (typeof STORY_PALETTES)[StoryTom]

function colorOf(p: Palette, c: StoryColor): string {
  return c === 'text' ? p.text : c === 'muted' ? p.muted : p.accent
}

const ICON_PATHS: Record<IconName, string[]> = {
  // maleta
  vagas: [
    'M4 8.5h16a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5V10A1.5 1.5 0 0 1 4 8.5z',
    'M8.5 8.5V6.5A1.5 1.5 0 0 1 10 5h4a1.5 1.5 0 0 1 1.5 1.5v2',
    'M2.5 13.5h19',
    'M12 12.5v2',
  ],
  // prédio
  empresas: [
    'M5 20.5V4.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v16',
    'M14 9.5h4a1 1 0 0 1 1 1v10',
    'M3 20.5h18',
    'M8 7.5h3', 'M8 11h3', 'M8 14.5h3',
    'M16 13h1', 'M16 16.5h1',
  ],
}

function Icon({ name, size, color }: { name: IconName; size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      {ICON_PATHS[name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}

function renderItem(it: StoryItem, p: Palette, k: string, logoSrc: string | null, imageSrc: string | null) {
  switch (it.kind) {
    case 'text': {
      const role = STORY_ROLES[it.role]
      const estilo = {
        fontFamily: role.fontFamily, fontWeight: role.fontWeight, fontStyle: role.fontStyle,
        fontSize: `${it.fontSize}px`, color: colorOf(p, it.color),
        ...(it.letterSpacingEm ? { letterSpacing: `${it.letterSpacingEm}em` } : {}),
      }
      // Cada palavra na posição exata da fonte (com kerning): o Satori reserva
      // para cada palavra a soma das letras soltas, sem kerning, e a sobra ia
      // para o vão seguinte. Parte inteira na posição, fração por deslocamento.
      return it.lines.map((l, i) => l.palavras ? (
        <div key={`${k}-${i}`} style={{
          position: 'absolute', left: `${l.x}px`, top: `${l.y}px`, width: `${l.w}px`, height: `${l.h}px`, display: 'flex',
        }}>
          {l.palavras.map((w, j) => (
            <span key={j} style={{
              ...estilo, position: 'absolute', left: `${Math.floor(w.dx)}px`, top: '0px', height: `${l.h}px`,
              lineHeight: `${l.h}px`, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap',
              ...(w.dx % 1 ? { transform: `translateX(${Math.round((w.dx % 1) * 100) / 100}px)` } : {}),
            }}>{w.t}</span>
          ))}
        </div>
      ) : (
        <div key={`${k}-${i}`} style={{
          position: 'absolute', left: `${l.x}px`, top: `${l.y}px`, height: `${l.h}px`,
          display: 'flex', alignItems: 'center', whiteSpace: 'nowrap',
          fontFamily: role.fontFamily, fontWeight: role.fontWeight, fontStyle: role.fontStyle,
          fontSize: `${it.fontSize}px`, lineHeight: `${l.h}px`, color: colorOf(p, it.color),
          ...(it.letterSpacingEm ? { letterSpacing: `${it.letterSpacingEm}em` } : {}),
        }}>{l.text}</div>
      ))
    }
    case 'rule':
      return <div key={k} style={{ position: 'absolute', left: `${it.x}px`, top: `${it.y}px`, width: `${it.w}px`, height: `${it.h}px`, backgroundColor: p.accent }} />
    case 'logo':
      return logoSrc ? (
        <img key={k} src={logoSrc} alt="" width={it.size} height={it.size} style={{
          position: 'absolute', left: `${it.x}px`, top: `${it.y}px`, width: `${it.size}px`, height: `${it.size}px`,
          borderRadius: '50%', objectFit: 'cover',
        }} />
      ) : (
        <div key={k} style={{
          position: 'absolute', left: `${it.x}px`, top: `${it.y}px`, width: `${it.size}px`, height: `${it.size}px`,
          borderRadius: '50%', backgroundColor: p.text,
        }} />
      )
    case 'image': {
      const caixa = { position: 'absolute' as const, left: `${it.x}px`, top: `${it.y}px`, width: `${it.w}px`, height: `${it.h}px` }
      const raio = it.raio ? { borderRadius: `${it.raio}px` } : {}
      // Sombra e contorno em camadas próprias, atrás da arte: a arte fica intacta.
      const sombra = it.sombra
        ? [<div key={`${k}-sombra`} style={{ ...caixa, ...raio, backgroundColor: p.bg, boxShadow: '0 10px 28px rgba(0,0,0,0.32)' }} />]
        : []
      const c = it.contorno || 0
      const contorno = c
        ? [<div key={`${k}-contorno`} style={{
          position: 'absolute', left: `${it.x - c}px`, top: `${it.y - c}px`, width: `${it.w + 2 * c}px`, height: `${it.h + 2 * c}px`,
          borderRadius: `${(it.raio || 0) + c}px`, backgroundColor: 'rgba(243,238,227,0.4)',
        }} />]
        : []
      return [
        ...sombra,
        ...contorno,
        imageSrc ? (
          <img key={k} src={imageSrc} alt="" width={it.w} height={it.h} style={{ ...caixa, ...raio }} />
        ) : (
          <div key={k} style={{ ...caixa, ...raio, border: `2px solid ${p.muted}`, boxSizing: 'border-box' }} />
        ),
      ]
    }
    case 'pill':
      // Selo da moldura em tela cheia: pílula verde #2C4A3B com 90% de opacidade.
      return (
        <div key={k} style={{
          position: 'absolute', left: `${it.x}px`, top: `${it.y}px`, width: `${it.w}px`, height: `${it.h}px`,
          borderRadius: `${it.h / 2}px`, backgroundColor: 'rgba(44,74,59,0.9)',
        }} />
      )
    case 'icon':
      return (
        <div key={k} style={{ position: 'absolute', left: `${it.x}px`, top: `${it.y}px`, width: `${it.size}px`, height: `${it.size}px`, display: 'flex' }}>
          <Icon name={it.name} size={it.size} color={p.text} />
        </div>
      )
    case 'ring':
      return (
        <div key={k} style={{
          position: 'absolute', left: `${it.cx - it.r}px`, top: `${it.cy - it.r}px`, width: `${it.r * 2}px`, height: `${it.r * 2}px`,
          borderRadius: '50%', border: `${it.stroke}px solid ${p.accent}`, boxSizing: 'border-box',
        }} />
      )
  }
}

export interface StoryImageProps {
  layout: StoryLayout
  logoSrc: string | null
  imageSrc?: string | null
  /** Só o fundo (verificação de tinta no gerador de exemplos). */
  hideAll?: boolean
  /** Só o fundo e a imagem da vaga (isola a tinta do selo na tela cheia). */
  onlyImage?: boolean
}

export function StoryImage({ layout, logoSrc, imageSrc = null, hideAll, onlyImage }: StoryImageProps) {
  const p = STORY_PALETTES[layout.tom]
  return (
    <div style={{
      width: `${STORY.width}px`, height: `${STORY.height}px`, position: 'relative', display: 'flex', overflow: 'hidden',
      backgroundColor: p.bg,
    }}>
      {hideAll ? null : layout.items.filter(it => !onlyImage || it.kind === 'image').flatMap((it, i) => {
        const el = renderItem(it, p, `s${i}`, logoSrc, imageSrc)
        return Array.isArray(el) ? el : [el]
      })}
    </div>
  )
}
