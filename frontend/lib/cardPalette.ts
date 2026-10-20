/**
 * lib/cardPalette.ts
 *
 * Identidade visual oficial da Capital Humano Intelligence · 4 famílias -- fonte única, usada pelo
 * servidor (app/api/export-card/route.tsx) e pelo cliente
 * (components/CardGenerator.tsx). Paleta oficial: verde #2C4A3B, terracota
 * #BC5B2E, creme #F3EEE3, grafite #1F1F1D, dourado #A9822E (ver auditoria de
 * marca de 2026-09-17). Cada família tem propósito de conteúdo, não é só cor:
 * Diagnóstico (framework/análise/método), Alerta (contradição/provocação),
 * Dado (indicador/comparação/evidência), Ideia (manifesto que para o scroll).
 */

export type FamilyKey = 'diagnostico' | 'alerta' | 'dado' | 'ideia'

export interface FamilyPalette {
  label: string
  eyebrow: string
  bg: string
  text: string
  muted: string
  accent: string
  accentContrast: string
  line: string
  /** Cor do endereço (link) na última linha do slide: dourado claro sobre
   *  verde, creme sobre terracota, verde sobre creme. */
  link: string
}

export const FAMILIES: Record<FamilyKey, FamilyPalette> = {
  diagnostico: {
    label: 'Diagnóstico',
    eyebrow: 'Diagnóstico Estratégico',
    bg: '#2C4A3B', text: '#F3EEE3', muted: 'rgba(243,238,227,0.65)',
    accent: '#A9822E', accentContrast: '#D3AF63', line: 'rgba(243,238,227,0.18)', link: '#D3AF63',
  },
  alerta: {
    label: 'Alerta',
    eyebrow: 'Ponto de Atenção',
    bg: '#BC5B2E', text: '#F3EEE3', muted: 'rgba(243,238,227,0.72)',
    accent: '#1F1F1D', accentContrast: '#F3EEE3', line: 'rgba(243,238,227,0.22)', link: '#F3EEE3',
  },
  dado: {
    label: 'Dado',
    eyebrow: 'Leitura de Dado',
    bg: '#F3EEE3', text: '#1F1F1D', muted: 'rgba(31,31,29,0.6)',
    accent: '#2C4A3B', accentContrast: '#2C4A3B', line: 'rgba(31,31,29,0.14)', link: '#2C4A3B',
  },
  ideia: {
    label: 'Ideia',
    eyebrow: 'Manifesto Capital Humano Intelligence',
    bg: '#2C4A3B', text: '#F3EEE3', muted: 'rgba(243,238,227,0.7)',
    accent: '#A9822E', accentContrast: '#D3AF63', line: 'rgba(243,238,227,0.18)', link: '#D3AF63',
  },
}

/** Ideia alterna entre verde profundo e terracota. No terracota, o destaque
 *  vira grafite: dourado-sobre-laranja tem contraste baixo (mesma família de
 *  matiz), grafite é o mesmo par já usado no Alerta pro mesmo fundo. */
export function ideiaPalette(tone: unknown): FamilyPalette {
  if (tone === 'terracota') {
    return {
      ...FAMILIES.ideia, bg: '#BC5B2E', muted: 'rgba(243,238,227,0.72)',
      line: 'rgba(243,238,227,0.22)', accentContrast: '#1F1F1D', link: '#F3EEE3',
    }
  }
  return FAMILIES.ideia
}

export function toFamilyKey(key: unknown): FamilyKey {
  return typeof key === 'string' && key in FAMILIES ? (key as FamilyKey) : 'diagnostico'
}

export function resolveFamily(key: unknown, ideiaTone: unknown): FamilyPalette {
  const k = toFamilyKey(key)
  return k === 'ideia' ? ideiaPalette(ideiaTone) : FAMILIES[k]
}

export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
