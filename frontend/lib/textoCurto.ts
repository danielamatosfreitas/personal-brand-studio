/**
 * lib/textoCurto.ts
 * Prévia de texto nas listas (Início, Agendados, Não publicados): primeira linha
 * com conteúdo, cortada em palavra inteira e seguida de reticências.
 *
 * Sem dependências, para ser testado direto no Node (tests/texto-curto.test.mjs).
 */

/** Corta em até `max` caracteres (sem contar a reticência), sem partir palavra. */
export function cortarEmPalavra(texto: string, max: number): string {
  const t = texto.trim()
  if (t.length <= max) return t
  let corte = t.slice(0, max)
  // A palavra só está inteira se o caractere seguinte for espaço.
  if (!/\s/.test(t[max])) {
    const espaco = corte.search(/\s\S*$/)
    if (espaco > 0) corte = corte.slice(0, espaco)
  }
  // Sem pontuação solta antes da reticência ("salário.…", "cargos,…").
  return `${corte.replace(/[\s.,;:!?(\[{"'“‘-]+$/, '')}…`
}

/** Primeira linha com conteúdo do texto, já cortada para a prévia. */
export function previaPrimeiraLinha(conteudo: string, max: number): string {
  const linha = conteudo.split('\n').map(l => l.trim()).find(Boolean) || ''
  return cortarEmPalavra(linha, max)
}
