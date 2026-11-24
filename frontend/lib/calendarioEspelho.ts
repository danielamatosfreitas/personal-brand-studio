/**
 * lib/calendarioEspelho.ts
 *
 * Página Calendário (20/10): espelho só de leitura do calendário oficial
 * (arquivo HTML da pasta MARKETING, mantido pela sessão Calendário). Formato
 * do espelho: docs/espelho-calendario.md no backend. Aqui fica só a lógica
 * de exibição (semana, filtro, rótulos), em horário de Brasília.
 *
 * Sem dependências, para ser testado direto no Node (tests/calendario-espelho.test.mjs).
 */

export type RedeEspelho = 'linkedin_pessoal' | 'linkedin_empresa' | 'instagram' | 'facebook' | 'stories'

export interface ItemEspelho {
  id: string
  data: string
  hora?: string | null
  rede: RedeEspelho
  codigo?: string | null
  titulo: string
  formato?: string | null
  slides?: number | null
  cor?: string | null
  status?: string | null
  legenda?: string | null
  primeiro_comentario?: string | null
  titulo_documento?: string | null
  roteiro?: string | null
  notas?: string | null
}

export interface EspelhoCalendario {
  versao?: number
  gerado_em?: string
  recebido_em?: string
  fonte?: string | null
  itens: ItemEspelho[]
  vazio?: boolean
}

export const REDES: { chave: RedeEspelho; nome: string }[] = [
  { chave: 'linkedin_pessoal', nome: 'LinkedIn pessoal' },
  { chave: 'linkedin_empresa', nome: 'LinkedIn empresa' },
  { chave: 'instagram', nome: 'Instagram' },
  { chave: 'facebook', nome: 'Facebook' },
  { chave: 'stories', nome: 'Stories' },
]

export const nomeRede = (r: string) => REDES.find(x => x.chave === r)?.nome ?? r

export const CORES: Record<string, string> = { verde: '#2C4A3B', creme: '#F3EEE3', manteiga: '#F1E5C7', terracota: '#BC5B2E' }

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const FUSO = 'America/Sao_Paulo'

/** Data de hoje (AAAA-MM-DD) no horário de Brasília. */
export function hojeBrasilia(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)
}

function utc(data: string): Date {
  const [a, m, d] = data.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d))
}
const iso = (d: Date) => d.toISOString().slice(0, 10)
const ddmm = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}`

/** Segunda-feira da semana da data (semana de segunda a domingo). */
export function segundaDaSemana(data: string): string {
  const d = utc(data)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return iso(d)
}

/** "Ter, 27/10" */
export function dataCurta(data: string): string {
  return `${DIAS[utc(data).getUTCDay()]}, ${ddmm(data)}`
}

/** "Atualizado em 20/10 às 12:00" (horário de Brasília). */
export function atualizadoEm(geradoEm?: string): string {
  if (!geradoEm) return ''
  const d = new Date(geradoEm)
  if (isNaN(d.getTime())) return ''
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map(x => [x.type, x.value]))
  return `Atualizado em ${p.day}/${p.month} às ${p.hour}:${p.minute}`
}

/** Rótulo do formato, sem imagens nesta versão: "8 slides", "PDF", "Reel"... */
export function rotuloFormato(it: Pick<ItemEspelho, 'formato' | 'slides'>): string {
  switch (it.formato) {
    case 'carrossel': return it.slides ? `${it.slides} slides` : 'Carrossel'
    case 'pdf': return 'PDF'
    case 'reel': return 'Reel'
    case 'card': return 'Card'
    case 'texto': return 'Texto'
    case 'stories': return 'Stories'
    case 'imagem': return 'Imagem'
    case 'video': return 'Vídeo'
    default: return it.slides ? `${it.slides} slides` : ''
  }
}

export interface Semana { inicio: string; rotulo: string; itens: ItemEspelho[] }

/** Itens de hoje em diante, da rede escolhida (ou todas), por semana e em ordem de data e hora. */
export function porSemana(itens: ItemEspelho[], hoje: string, rede: RedeEspelho | 'todas' = 'todas'): Semana[] {
  const lista = itens
    .filter(it => it.data >= hoje && (rede === 'todas' || it.rede === rede))
    .sort((a, b) => a.data.localeCompare(b.data) || (a.hora ?? '99:99').localeCompare(b.hora ?? '99:99')
      || REDES.findIndex(r => r.chave === a.rede) - REDES.findIndex(r => r.chave === b.rede))
  const semanas: Semana[] = []
  for (const it of lista) {
    const inicio = segundaDaSemana(it.data)
    let s = semanas[semanas.length - 1]
    if (!s || s.inicio !== inicio) {
      const fim = utc(inicio)
      fim.setUTCDate(fim.getUTCDate() + 6)
      s = { inicio, rotulo: `Semana de ${ddmm(inicio)} a ${ddmm(iso(fim))}`, itens: [] }
      semanas.push(s)
    }
    s.itens.push(it)
  }
  return semanas
}

/** Campos de texto completos do item, na ordem da tela; só os que têm conteúdo. */
export function camposDeTexto(it: ItemEspelho): { rotulo: string; texto: string }[] {
  return ([
    ['Legenda', it.legenda], ['Primeiro comentário', it.primeiro_comentario],
    ['Título do documento', it.titulo_documento], ['Roteiro', it.roteiro], ['Notas', it.notas],
  ] as [string, string | null | undefined][])
    .filter(([, t]) => typeof t === 'string' && t.trim() !== '')
    .map(([rotulo, texto]) => ({ rotulo, texto: texto as string }))
}
