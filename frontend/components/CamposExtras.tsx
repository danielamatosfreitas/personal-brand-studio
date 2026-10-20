'use client'

/**
 * Campos extras de um post novo (19/10): título do documento (obrigatório
 * para PDF no LinkedIn; nunca tirado da legenda), primeiro comentário (feito
 * à mão depois que o post sai) e código da peça.
 */

export interface ValoresExtras {
  titulo: string
  comentario: string
  codigo: string
}

export const EXTRAS_VAZIOS: ValoresExtras = { titulo: '', comentario: '', codigo: '' }

export const SEM_TITULO = 'Informe o título do documento (PDF). O app não usa a legenda como título.'

/** Campos para postsApi.create: só os preenchidos; o título só quando o post usa. */
export function extrasParaCriar(v: ValoresExtras, usaTitulo: boolean) {
  const titulo = v.titulo.trim()
  const comentario = v.comentario.trim()
  const codigo = v.codigo.trim()
  return {
    ...(usaTitulo && titulo ? { titulo_documento: titulo } : {}),
    ...(comentario ? { primeiro_comentario: comentario } : {}),
    ...(codigo ? { codigo_peca: codigo } : {}),
  }
}

interface CamposExtrasProps {
  valores: ValoresExtras
  onChange: (v: ValoresExtras) => void
  usaTitulo: boolean
}

export function CamposExtras({ valores, onChange, usaTitulo }: CamposExtrasProps) {
  return (
    <div className="mb-6 space-y-4">
      {usaTitulo && (
        <div>
          <label className="field-label">Título do documento (PDF no LinkedIn)</label>
          <input value={valores.titulo} onChange={e => onChange({ ...valores, titulo: e.target.value })} maxLength={200}
            placeholder="Ex.: Quando tudo passa pelo dono" className="input"/>
          <p className="text-sm text-brand-text-muted mt-1">Obrigatório. É o título que aparece no documento do LinkedIn.</p>
        </div>
      )}
      <div>
        <label className="field-label">Primeiro comentário (opcional)</label>
        <textarea value={valores.comentario} onChange={e => onChange({ ...valores, comentario: e.target.value })} rows={3}
          placeholder="Texto que você comenta à mão depois que o post sair" className="input resize-none text-base"/>
      </div>
      <div>
        <label className="field-label">Código da peça (opcional)</label>
        <input value={valores.codigo} onChange={e => onChange({ ...valores, codigo: e.target.value })} maxLength={40}
          placeholder="Ex.: pt056 ou C2 #09" className="input sm:w-64"/>
      </div>
    </div>
  )
}
