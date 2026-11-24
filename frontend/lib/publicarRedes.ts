/**
 * lib/publicarRedes.ts
 *
 * "Publicar mídia pronta" com mais de uma rede (Fase 4, 16/10): a opção
 * "Instagram + Facebook" cria dois posts independentes, um por rede, cada um
 * com o seu status. Uma rede falhar nunca cancela a outra: cada ação roda
 * sozinha e o resultado volta por rede.
 *
 * Sem dependências, para ser testado direto no Node (tests/publicar-redes.test.mjs).
 */

export type Rede = 'linkedin' | 'instagram' | 'facebook'
export type Destino = Rede | 'instagram+facebook'

export const NOME_REDE: Record<Rede, string> = { linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook' }

export function redesDe(destino: Destino): Rede[] {
  return destino === 'instagram+facebook' ? ['instagram', 'facebook'] : [destino]
}

/** Instagram e Facebook só publicam imagens (1 a 10); o LinkedIn aceita texto, PDF e vídeo. */
export function soImagens(destino: Destino): boolean {
  return redesDe(destino).some(r => r !== 'linkedin')
}

export interface ResultadoRede {
  rede: Rede
  ok: boolean
  /** id do post criado/publicado, quando deu certo */
  id?: string
  erro?: string
}

/** Roda a ação em cada rede, uma independente da outra (falha de uma não para a outra). */
export async function porRede(redes: Rede[], acao: (rede: Rede) => Promise<string>): Promise<ResultadoRede[]> {
  const feitos = await Promise.allSettled(redes.map(r => acao(r)))
  return feitos.map((f, i) => f.status === 'fulfilled'
    ? { rede: redes[i], ok: true, id: f.value }
    : { rede: redes[i], ok: false, erro: f.reason instanceof Error ? f.reason.message : String(f.reason) })
}

/** Uma linha por rede, para o aviso na tela. */
export function resumo(resultados: ResultadoRede[], feito: string): { texto: string; tipo: 'success' | 'error' } {
  if (resultados.length === 1) {
    const r = resultados[0]
    return r.ok ? { texto: `${feito[0].toUpperCase()}${feito.slice(1)} no ${NOME_REDE[r.rede]}.`, tipo: 'success' }
      : { texto: r.erro || 'Não deu certo.', tipo: 'error' }
  }
  const texto = resultados.map(r => r.ok ? `${NOME_REDE[r.rede]}: ${feito}.` : `${NOME_REDE[r.rede]}: não deu certo (${r.erro}).`).join(' ')
  return { texto, tipo: resultados.every(r => r.ok) ? 'success' : 'error' }
}
