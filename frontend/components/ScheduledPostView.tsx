'use client'

/**
 * Painel "Ver" e formulário "Editar" dos Agendados (19/10).
 * Ver: o post completo exatamente como vai sair (texto com quebras de linha
 * e hashtags, mídias na ordem, primeira página do PDF, primeiro comentário).
 * Editar: texto, primeiro comentário, código da peça e horário, sem cancelar.
 */

import { useState } from 'react'
import { postsApi, type PreviaPost, type EdicaoPost } from '../services/api'
import { IconSpinner } from './ui'

const FUSO = 'America/Sao_Paulo'

export function dataHora(iso: string | null) {
  if (!iso) return 'Sem agendamento'
  return new Date(iso).toLocaleString('pt-BR', { timeZone: FUSO, dateStyle: 'full', timeStyle: 'short' })
}

/** ISO para o valor do campo datetime-local, no horário de Brasília. */
function paraCampo(iso: string | null) {
  if (!iso) return ''
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

/** Valor do campo (horário de Brasília) para ISO. Brasília não tem horário
 *  de verão desde 2019: o fuso é sempre 3 horas a menos que UTC. */
function doCampo(valor: string) {
  return `${valor}:00-03:00`
}

export async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = texto
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(area)
      return ok
    } catch {
      return false
    }
  }
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-wide text-brand-text-muted mb-1">{children}</p>
}

export function PainelVer({ previa }: { previa: PreviaPost }) {
  const [copiado, setCopiado] = useState<string | null>(null)
  const pdf = previa.midias.find(m => m.tipo === 'pdf')

  const handleCopiar = async () => {
    const ok = await copiar(previa.primeiro_comentario || '')
    setCopiado(ok ? 'Comentário copiado.' : 'Não deu para copiar sozinho: selecione o texto e copie.')
  }

  return (
    <div className="mt-3 rounded-lg border border-brand-border bg-white/60 p-4 space-y-5" role="region" aria-label="Post completo">
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Rotulo>Rede</Rotulo><p className="text-sm text-brand-text">{previa.rede} ({previa.destino})</p></div>
        <div><Rotulo>Data e hora</Rotulo><p className="text-sm text-brand-text">{dataHora(previa.scheduled_at)}</p></div>
        <div>
          <Rotulo>Código da peça</Rotulo>
          <p className="text-sm text-brand-text">{previa.codigo_peca || 'Não informado (informe em Editar)'}</p>
        </div>
      </div>

      <div>
        <Rotulo>Texto completo, como será publicado ({previa.caracteres} caracteres)</Rotulo>
        <pre className="whitespace-pre-wrap break-words font-sans text-sm text-brand-text bg-brand-background rounded-md p-3 max-h-[28rem] overflow-y-auto">{previa.content}</pre>
      </div>

      <div>
        <Rotulo>{pdf ? 'Documento (PDF)' : previa.midias.length > 1 ? `Imagens, na ordem (${previa.midias.length})` : 'Mídia'}</Rotulo>
        {previa.midias.length === 0 ? (
          <p className="text-sm text-brand-text-muted">Sem mídia: sai só o texto.</p>
        ) : pdf ? (
          <div className="flex flex-col sm:flex-row gap-4">
            {pdf.primeira_pagina ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pdf.primeira_pagina} alt="Primeira página do PDF" className="w-48 rounded-md border border-brand-border"/>
            ) : (
              <p className="text-sm text-red-700">{pdf.motivo || 'Não foi possível mostrar a primeira página.'}</p>
            )}
            <div className="text-sm text-brand-text space-y-1">
              {pdf.paginas !== undefined && <p>{pdf.paginas} {pdf.paginas === 1 ? 'página' : 'páginas'}</p>}
              {previa.usa_titulo && (previa.titulo_documento
                ? <p>Título do documento no LinkedIn: <span className="font-medium">{previa.titulo_documento}</span></p>
                : <p className="text-red-700 font-medium" role="alert">Falta o título do documento. Sem ele, o post não sai: preencha em Editar.</p>)}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {previa.midias.map(m => (
              <figure key={m.n} className="relative">
                {m.tipo === 'imagem' && m.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt={`Imagem ${m.n}`} className="w-full aspect-[4/5] object-cover rounded-md border border-brand-border"/>
                ) : (
                  <div className="w-full aspect-[4/5] rounded-md border border-brand-border flex items-center justify-center text-xs text-brand-text-muted">
                    {m.tipo === 'video' ? 'Vídeo' : 'Arquivo'}
                  </div>
                )}
                <figcaption className="absolute top-1 left-1 rounded bg-black/60 px-1.5 text-xs text-white">{m.n}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-md border border-brand-primary/30 bg-brand-background p-3">
        <Rotulo>Primeiro comentário</Rotulo>
        <p className="text-sm font-medium text-brand-text">Faça o primeiro comentário à mão depois que o post sair.</p>
        <p className="text-sm text-brand-text-muted mb-2">Horário previsto: logo depois de {dataHora(previa.scheduled_at)}.</p>
        {previa.primeiro_comentario ? (
          <>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm text-brand-text bg-white rounded-md p-3">{previa.primeiro_comentario}</pre>
            <div className="flex items-center gap-3 mt-2">
              <button onClick={handleCopiar} className="btn-outline px-4 py-2 text-sm">Copiar</button>
              {copiado && <span className="text-sm text-brand-text-muted" role="status">{copiado}</span>}
            </div>
          </>
        ) : (
          <p className="text-sm text-brand-text-muted">
            {previa.extras_ativos ? 'Nenhum comentário cadastrado. Cadastre em Editar.' : 'O cadastro do primeiro comentário ainda não foi ativado no banco.'}
          </p>
        )}
      </div>
    </div>
  )
}

interface FormEditarProps {
  previa: PreviaPost
  onSalvo: (nova: PreviaPost, mensagem: string) => void
  onFechar: () => void
}

export function FormEditar({ previa, onSalvo, onFechar }: FormEditarProps) {
  const [texto, setTexto] = useState(previa.content)
  const [comentario, setComentario] = useState(previa.primeiro_comentario || '')
  const [codigo, setCodigo] = useState(previa.codigo_peca || '')
  const [titulo, setTitulo] = useState(previa.titulo_documento || '')
  const [horario, setHorario] = useState(paraCampo(previa.scheduled_at))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const handleSalvar = async () => {
    // Só vai o que mudou: o resto do post não é tocado.
    const dados: EdicaoPost = {}
    if (texto !== previa.content) dados.content = texto
    if (horario && horario !== paraCampo(previa.scheduled_at)) dados.scheduled_at = doCampo(horario)
    if (previa.extras_ativos) {
      if (previa.usa_titulo && titulo !== (previa.titulo_documento || '')) {
        if (!titulo.trim()) {
          setErro('O título do documento não pode ficar vazio: sem ele o post não sai.')
          return
        }
        dados.titulo_documento = titulo
      }
      if (comentario !== (previa.primeiro_comentario || '')) dados.primeiro_comentario = comentario
      if (codigo !== (previa.codigo_peca || '')) dados.codigo_peca = codigo
    }
    if (Object.keys(dados).length === 0) {
      setErro('Nada mudou: o post continua igual.')
      return
    }
    setSalvando(true)
    setErro(null)
    try {
      const r = await postsApi.editar(previa.id, dados)
      onSalvo(r, r.mensagem)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar agora. Tente de novo.')
    } finally {
      setSalvando(false)
    }
  }

  const campo = 'w-full rounded-md border border-brand-border bg-white px-3 py-2 text-sm text-brand-text'

  return (
    <div className="mt-3 rounded-lg border border-brand-border bg-white/60 p-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <Rotulo>Data e hora (horário de Brasília)</Rotulo>
          <input type="datetime-local" value={horario} onChange={e => setHorario(e.target.value)} className={campo}/>
        </label>
        <label className="block">
          <Rotulo>Código da peça</Rotulo>
          <input value={codigo} onChange={e => setCodigo(e.target.value)} maxLength={40} placeholder="Ex.: pt056 ou C2 #09"
            disabled={!previa.extras_ativos} className={campo}/>
        </label>
      </div>
      {previa.usa_titulo && (
        <label className="block">
          <Rotulo>Título do documento (PDF no LinkedIn)</Rotulo>
          <input value={titulo} onChange={e => setTitulo(e.target.value)} maxLength={200} placeholder="Ex.: Quando tudo passa pelo dono"
            disabled={!previa.extras_ativos} className={campo}/>
        </label>
      )}
      <label className="block">
        <Rotulo>Texto ({texto.length} caracteres)</Rotulo>
        <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={12} className={`${campo} font-sans`}/>
      </label>
      <label className="block">
        <Rotulo>Primeiro comentário (feito à mão depois que o post sair)</Rotulo>
        <textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={4}
          disabled={!previa.extras_ativos} className={`${campo} font-sans`}/>
      </label>
      {!previa.extras_ativos && (
        <p className="text-sm text-brand-text-muted">Título do documento, código da peça e primeiro comentário ficam disponíveis assim que o banco for atualizado.</p>
      )}
      {erro && <p className="text-sm text-red-700" role="alert">{erro}</p>}
      <div className="flex flex-wrap gap-3">
        <button onClick={handleSalvar} disabled={salvando} className="btn-primary px-4 py-2 text-sm">
          {salvando ? <span className="flex items-center gap-2"><IconSpinner/>Salvando...</span> : 'Salvar'}
        </button>
        <button onClick={onFechar} disabled={salvando} className="btn-outline px-4 py-2 text-sm">Fechar sem salvar</button>
      </div>
    </div>
  )
}
