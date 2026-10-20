'use client'

/**
 * Página Calendário (20/10): espelho só de leitura do calendário oficial,
 * enviado pela sessão Calendário. O app nunca edita nada aqui: só mostra e
 * copia os textos completos. Lógica de semana e filtro em lib/calendarioEspelho.ts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { calendarioApi } from '../services/api'
import {
  CORES, REDES, atualizadoEm, camposDeTexto, dataCurta, hojeBrasilia, nomeRede, porSemana, rotuloFormato,
  type EspelhoCalendario, type ItemEspelho, type RedeEspelho,
} from '../lib/calendarioEspelho'
import { copiar } from './ScheduledPostView'
import { IconCalendar, IconFacebook, IconInstagram, IconLinkedIn, IconSpinner, IconStories } from './ui'

function IconeRede({ rede }: { rede: string }) {
  const c = 'w-4 h-4'
  return rede === 'instagram' ? <IconInstagram className={c}/> : rede === 'facebook' ? <IconFacebook className={c}/>
    : rede === 'stories' ? <IconStories className={c}/> : <IconLinkedIn className={c}/>
}

function CampoTexto({ rotulo, texto }: { rotulo: string; texto: string }) {
  const [aviso, setAviso] = useState('')
  const handleCopiar = async () => {
    const ok = await copiar(texto)
    setAviso(ok ? 'Copiado.' : 'Não deu para copiar sozinho: selecione o texto e copie.')
    setTimeout(() => setAviso(''), 2500)
  }
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-brand-text-muted">{rotulo}</p>
        <div className="flex items-center gap-2">
          {aviso && <span className="text-xs text-brand-text-muted" role="status">{aviso}</span>}
          <button onClick={handleCopiar} className="btn-outline px-3 py-1.5 text-sm">Copiar</button>
        </div>
      </div>
      <pre className="whitespace-pre-wrap break-words font-sans text-[15px] leading-relaxed text-brand-text bg-brand-background rounded-md p-3">{texto}</pre>
    </div>
  )
}

function Item({ it, aberto, onToggle }: { it: ItemEspelho; aberto: boolean; onToggle: () => void }) {
  const formato = rotuloFormato(it)
  const campos = camposDeTexto(it)
  return (
    <li className="border-b border-brand-border last:border-b-0">
      <button onClick={onToggle} aria-expanded={aberto} className="w-full text-left py-4 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-brand-text">{dataCurta(it.data)}{it.hora ? ` · ${it.hora}` : ''}</span>
          <span className="flex items-center gap-1.5 text-sm text-brand-primary"><IconeRede rede={it.rede}/>{nomeRede(it.rede)}</span>
        </div>
        <p className="text-base font-medium text-brand-text leading-snug">
          {it.codigo && <span className="mr-2 text-sm font-medium text-brand-primary">{it.codigo}</span>}{it.titulo}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-brand-text-muted">
          {it.cor && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3.5 h-3.5 rounded-full border border-brand-border" style={{ backgroundColor: CORES[it.cor] ?? 'transparent' }}/>
              Fundo {it.cor}
            </span>
          )}
          {formato && <span>{formato}</span>}
          {it.status && <span className="rounded-full bg-brand-surface-muted px-2 py-0.5 text-xs text-brand-text">{it.status}</span>}
        </div>
      </button>
      {aberto && (
        <div className="pb-5 space-y-4">
          {campos.length === 0
            ? <p className="text-sm text-brand-text-muted">Sem texto registrado no calendário para este item.</p>
            : campos.map(c => <CampoTexto key={c.rotulo} rotulo={c.rotulo} texto={c.texto}/>)}
        </div>
      )}
    </li>
  )
}

export function CalendarioPanel() {
  const [espelho, setEspelho] = useState<EspelhoCalendario | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [rede, setRede] = useState<RedeEspelho | 'todas'>('todas')
  const [aberto, setAberto] = useState<string | null>(null)

  const carrega = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      setEspelho(await calendarioApi.espelho())
    } catch (e) {
      setErro(`Não foi possível abrir o calendário agora. ${e instanceof Error ? e.message : ''}`.trim())
    } finally {
      setCarregando(false)
    }
  }, [])
  useEffect(() => { carrega() }, [carrega])

  const semanas = useMemo(() => porSemana(espelho?.itens ?? [], hojeBrasilia(), rede), [espelho, rede])
  const atualizado = atualizadoEm(espelho?.gerado_em)

  return (
    <div className="card">
      <p className="text-sm text-brand-text-muted mb-1">Cópia só de leitura do calendário oficial.</p>
      <p className="text-sm font-medium text-brand-text mb-5" role="status">
        {carregando ? 'Carregando...' : atualizado || 'O Calendário ainda não enviou o espelho.'}
      </p>

      <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-1 px-1" role="group" aria-label="Filtrar por rede">
        {[{ chave: 'todas' as const, nome: 'Todas' }, ...REDES].map(r => (
          <button key={r.chave} onClick={() => setRede(r.chave)} aria-pressed={rede === r.chave}
            className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm transition-colors
              ${rede === r.chave ? 'bg-brand-primary text-white border-brand-primary' : 'border-brand-border text-brand-text'}`}>
            {r.nome}
          </button>
        ))}
      </div>

      {carregando ? (
        <div className="flex items-center gap-2 text-brand-text-muted text-sm py-2"><IconSpinner/>Carregando...</div>
      ) : erro ? (
        <p className="text-sm text-red-700" role="alert">{erro}</p>
      ) : semanas.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><IconCalendar className="w-5 h-5"/></div>
          <p className="text-sm text-brand-text-muted">
            {espelho?.vazio ? 'Quando o Calendário enviar o espelho, as publicações aparecem aqui.' : 'Nada de hoje em diante nesta rede.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {semanas.map(s => (
            <section key={s.inicio}>
              <h2 className="text-sm font-medium uppercase tracking-wide text-brand-text-muted mb-1">{s.rotulo}</h2>
              <ul className="border-t border-brand-border">
                {s.itens.map(it => (
                  <Item key={it.id} it={it} aberto={aberto === it.id} onToggle={() => setAberto(aberto === it.id ? null : it.id)}/>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
