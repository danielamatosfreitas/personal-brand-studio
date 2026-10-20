/**
 * services/api.ts
 * Conector central para o backend Personal Brand OS (Railway/FastAPI).
 * Todas as chamadas à API passam por aqui.
 */

import type { EspelhoCalendario } from '../lib/calendarioEspelho'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// ── Trava de acesso (senha única) ───────────────────────────────────────────────
// A senha NUNCA fica embutida no build do frontend (isso vazaria no bundle
// público, visível pra qualquer um). Ela só existe: (1) na cabeça de quem
// souber, (2) como variável de ambiente no Railway (que valida de verdade),
// e (3) no localStorage do navegador de quem já digitou ela e passou.

const ACCESS_TOKEN_KEY = 'pbos_access_token'

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(ACCESS_TOKEN_KEY)
  } catch {
    return null
  }
}

export function setAccessToken(token: string) {
  try { window.localStorage.setItem(ACCESS_TOKEN_KEY, token) } catch { /* noop */ }
}

export function clearAccessToken() {
  try { window.localStorage.removeItem(ACCESS_TOKEN_KEY) } catch { /* noop */ }
}

/** Testa uma senha contra o backend sem guardar nada — quem chama decide o que fazer com o resultado.
 *  Diferencia senha errada (resposta 401/403 do backend) de falha de rede/CORS
 *  (fetch nem completa) -- os dois casos pareciam a mesma coisa pro AuthGate
 *  antes (os dois viravam "false"), mas achar "senha incorreta" quando o
 *  problema era CORS bloqueando o preview do Netlify confundia a usuária. */
export type AccessCheckResult = 'valid' | 'invalid' | 'network_error'

export async function verifyAccessToken(token: string): Promise<AccessCheckResult> {
  try {
    const res = await fetch(`${API_URL}/api/v1/oauth/status`, {
      headers: { 'X-Access-Token': token },
    })
    return res.ok ? 'valid' : 'invalid'
  } catch {
    return 'network_error'
  }
}

// ── Tipos ──────────────────────────────────────────────────────────────────────

export type Platform = 'linkedin' | 'instagram' | 'facebook'
export type FormatType = 'text' | 'carousel' | 'quote'
export type PostStatus = 'draft' | 'scheduled' | 'published' | 'failed'

export interface OAuthStatusItem {
  platform: Platform
  connected: boolean
  platform_user_id?: string
  token_expires_at?: string
  is_expired: boolean
}

export interface OAuthStatusResponse {
  platforms: OAuthStatusItem[]
}

export interface GeneratePostRequest {
  topic: string
  platform: Platform
  format_type: FormatType
}

export interface GeneratePostResponse {
  platform: Platform
  topic: string
  format_type: FormatType
  generated_text: string
  char_count: number
  word_count: number
}

export interface PostCreate {
  platform: Platform | 'both'
  content: string
  media_urls?: string[]
  scheduled_at?: string
  linkedin_organization_urn?: string
  /** Obrigatório para PDF no LinkedIn; nunca tirado da legenda. */
  titulo_documento?: string
  primeiro_comentario?: string
  codigo_peca?: string
}

export interface PostResponse {
  id: string
  platform: Platform | 'both'
  content: string
  status: PostStatus
  platform_post_id?: string
  published_at?: string
  scheduled_at?: string
  linkedin_organization_urn?: string
  error_log?: string
  created_at: string
}

/** Página de empresa do LinkedIn que a usuária administra. */
export interface LinkedInOrganization {
  urn: string
  name: string
}

export interface PublishResponse {
  success: boolean
  post_id: string
  platform_post_id?: string
  message: string
}

export interface SlideUploadRequest {
  images_base64: string[]
  assemble_pdf?: boolean
}

export interface SlideUploadResponse {
  image_urls: string[]
  pdf_url: string | null
}

export interface FileUploadResponse {
  url: string
  content_type: string
}

// ── Helper interno ─────────────────────────────────────────────────────────────

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAccessToken()
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Access-Token': token } : {}),
      ...options.headers,
    },
    ...options,
  })

  if (res.status === 401) {
    // token guardado não vale mais (senha trocada, etc.) — manda de volta pro login
    clearAccessToken()
    if (typeof window !== 'undefined') window.location.reload()
    throw new Error('Sessão expirada. Faça login novamente.')
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Erro desconhecido.' }))
    throw new Error(error.detail || `Erro ${res.status}`)
  }

  return res.json() as Promise<T>
}

// ── OAuth ──────────────────────────────────────────────────────────────────────

export const oauthApi = {
  /** Retorna status de conexão de cada plataforma */
  getStatus: () =>
    request<OAuthStatusResponse>('/api/v1/oauth/status'),

  /** Inicia o fluxo OAuth: a senha vai no cabeçalho, como em todas as outras
   *  chamadas, e nunca no endereço (senha em URL fica em log de acesso e no
   *  histórico do navegador). O backend devolve o endereço de autorização da
   *  plataforma, e quem chama navega até ele. */
  iniciarConexao: (platform: Platform) =>
    request<{ url: string }>(`/api/v1/oauth/${platform}/start`, { method: 'POST' }),

  /** Páginas de empresa do LinkedIn que a usuária administra (exige reconexão
   *  com o escopo w_organization_social). Lista vazia = sem Páginas disponíveis
   *  (LinkedIn não conectado, escopo antigo, ou conta sem nenhuma Página). */
  getLinkedInOrganizations: () =>
    request<{ organizations: LinkedInOrganization[] }>('/api/v1/oauth/linkedin/organizations'),

  /** Conta do Instagram conectada, conferida com o próprio Instagram (Fase 3):
   *  @usuário, tipo de conta e se a permissão de publicar responde. */
  getContaInstagram: () =>
    request<ContaInstagram>('/api/v1/oauth/instagram/conta'),

  /** Página do Facebook conectada (Fase 4): só a página da empresa. */
  getContaFacebook: () =>
    request<ContaFacebook>('/api/v1/oauth/facebook/conta'),
}

export interface ContaFacebook {
  conectado: boolean
  pagina?: string | null
  pagina_certa?: boolean
  motivo?: string
}

export interface ContaInstagram {
  conectado: boolean
  conta?: string | null
  tipo?: string
  pode_publicar?: boolean
  publicacoes_24h?: { usadas?: number; total?: number }
  motivo?: string
}

// ── IA ─────────────────────────────────────────────────────────────────────────

export const aiApi = {
  /** Gera um post com IA no tom de voz de Daniela Matos */
  generatePost: (data: GeneratePostRequest) =>
    request<GeneratePostResponse>('/api/v1/ai/generate_post', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}

// ── Mídia (Fase 0) ────────────────────────────────────────────────────────────

export const mediaApi = {
  /** Sobe os slides (PNG em base64) pro Supabase Storage; converte pra JPEG e,
   *  se assemble_pdf, também monta um PDF multi-página (carrossel do LinkedIn). */
  uploadSlides: (data: SlideUploadRequest) =>
    request<SlideUploadResponse>('/api/v1/media/upload', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** Sobe um arquivo já pronto (JPG/PNG/PDF feito fora do sistema), sem conversão. */
  uploadFile: async (file: File): Promise<FileUploadResponse> => {
    const token = getAccessToken()
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${API_URL}/api/v1/media/upload-file`, {
      method: 'POST',
      headers: token ? { 'X-Access-Token': token } : undefined,
      body: formData,
    })
    if (res.status === 401) {
      clearAccessToken()
      if (typeof window !== 'undefined') window.location.reload()
      throw new Error('Sessão expirada. Faça login novamente.')
    }
    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: 'Erro desconhecido.' }))
      throw new Error(error.detail || `Erro ${res.status}`)
    }
    return res.json() as Promise<FileUploadResponse>
  },
}

// ── Posts ──────────────────────────────────────────────────────────────────────

export const postsApi = {
  /** Cria um rascunho de post no banco */
  create: (data: PostCreate) =>
    request<PostResponse>('/api/v1/posts/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** Lista todos os posts */
  list: (status?: PostStatus) => {
    const qs = status ? `?status=${status}` : ''
    return request<PostResponse[]>(`/api/v1/posts/${qs}`)
  },

  /** Publica um post nas redes sociais */
  publish: (postId: string) =>
    request<PublishResponse>(`/api/v1/posts/${postId}/publish`, {
      method: 'POST',
    }),

  /** Cancela um agendamento (o post volta a ser rascunho) */
  cancel: (postId: string) =>
    request<PostResponse>(`/api/v1/posts/${postId}/cancel`, {
      method: 'POST',
    }),

  /** Painel Ver: o post completo como vai sair. Só leitura. */
  previa: (postId: string) =>
    request<PreviaPost>(`/api/v1/posts/${postId}/previa`),

  /** Editar: muda só os campos enviados, sem cancelar o agendamento. */
  editar: (postId: string, dados: EdicaoPost) =>
    request<PreviaPost & { mensagem: string }>(`/api/v1/posts/${postId}`, {
      method: 'PATCH',
      body: JSON.stringify(dados),
    }),
}

export interface MidiaPrevia {
  n: number
  tipo: 'imagem' | 'pdf' | 'video' | 'outro'
  arquivo: string
  url?: string
  paginas?: number
  primeira_pagina?: string
  motivo?: string
}

export interface PreviaPost {
  id: string
  platform: Platform | 'both'
  rede: string
  destino: string
  status: PostStatus
  scheduled_at: string | null
  content: string
  caracteres: number
  /** true quando o post sai como documento (PDF) no LinkedIn */
  usa_titulo: boolean
  titulo_documento: string | null
  midias: MidiaPrevia[]
  codigo_peca: string | null
  primeiro_comentario: string | null
  /** false enquanto a tabela post_extras não existir no banco */
  extras_ativos: boolean
}

export interface EdicaoPost {
  content?: string
  titulo_documento?: string
  scheduled_at?: string
  codigo_peca?: string
  primeiro_comentario?: string
}

// ── Calendário (espelho só de leitura, 20/10) ────────────────────────────────

export const calendarioApi = {
  /** Espelho do calendário oficial, enviado pela sessão Calendário. */
  espelho: () => request<EspelhoCalendario>('/api/v1/calendario/espelho'),
}
