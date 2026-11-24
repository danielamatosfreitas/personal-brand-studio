// API de exemplo do modo de demonstração (npm run demo).
// Responde todos os caminhos que o frontend chama, com dados fictícios guardados
// só na memória. Nada aqui fala com banco, com o LinkedIn, com a Meta ou com IA:
// publicar, agendar e conectar contas só simulam a resposta.
// Só módulos nativos do Node.

import http from 'node:http'
import { pathToFileURL } from 'node:url'

export const PORTA_API_PADRAO = 8710

/** Data e hora a partir de hoje (d dias depois, às h horas), em ISO. */
const dia = (d, h, min = 0) => {
  const x = new Date()
  x.setDate(x.getDate() + d)
  x.setHours(h, min, 0, 0)
  return x.toISOString()
}

/** AAAA-MM-DD no horário de Brasília, d dias depois de hoje. */
const dataBrasilia = d => {
  const x = new Date(Date.now() + d * 86400000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(x)
}

function postsIniciais() {
  return [
    { id: 'ex-1', platform: 'linkedin', status: 'scheduled', scheduled_at: dia(1, 9), created_at: dia(-1, 10),
      content: 'Turnover alto raramente é um problema de salário. Na maioria das empresas que crescem rápido, o que falta é clareza de papéis e líderes preparados para conversar sobre desempenho.' },
    { id: 'ex-2', platform: 'both', status: 'scheduled', scheduled_at: dia(2, 12), created_at: dia(-1, 11),
      content: 'Carrossel: 5 sinais de que a sua equipe precisa de um plano de cargos. Arraste para ver o diagnóstico rápido.' },
    { id: 'ex-3', platform: 'instagram', status: 'scheduled', scheduled_at: dia(3, 18), created_at: dia(-1, 12),
      content: 'Frase da semana: cultura é o que acontece quando ninguém está olhando.' },
    { id: 'ex-4', platform: 'facebook', status: 'scheduled', scheduled_at: dia(4, 10), created_at: dia(-1, 13),
      content: 'Convite: diagnóstico gratuito de gestão de pessoas para pequenas empresas. Link na página.' },
  ]
}

function espelhoCalendario() {
  const item = (d, hora, rede, codigo, titulo, formato, extra = {}) => ({
    id: `${dataBrasilia(d)}-${codigo || 'item'}-${rede}`, data: dataBrasilia(d), hora, rede, codigo, titulo, formato,
    cor: null, status: 'Texto aprovado', ...extra,
  })
  return {
    versao: 1,
    gerado_em: new Date().toISOString(),
    fonte: 'dados de exemplo do modo de demonstração',
    itens: [
      item(0, '09:00', 'linkedin_pessoal', 'ex01', 'O custo de uma contratação errada', 'texto', {
        legenda: 'Uma contratação errada custa mais do que o salário: custa o tempo da equipe, o retrabalho e o cliente que espera.\n\nAntes de abrir a próxima vaga, vale responder: o que essa pessoa precisa entregar nos primeiros 90 dias?',
      }),
      item(1, '12:00', 'linkedin_empresa', 'ex02', 'Cinco sinais de que falta um plano de cargos', 'carrossel', {
        slides: 6, cor: 'verde', status: 'Card aprovado',
        legenda: 'Salários diferentes para a mesma função, promoções sem critério e pedidos de demissão de quem mais entrega. O carrossel mostra os cinco sinais.',
        titulo_documento: 'Cinco sinais de que falta um plano de cargos',
      }),
      item(2, '18:00', 'instagram', 'ex03', 'Frase da semana', 'card', {
        cor: 'terracota', status: 'Card aprovado',
        legenda: 'Cultura é o que acontece quando ninguém está olhando.\n\n#gestaodepessoas #lideranca',
      }),
      item(2, null, 'stories', null, 'Enquete sobre reuniões de equipe', 'stories', {
        roteiro: 'Enquete: "Sua equipe tem uma reunião curta toda semana?" (opções: Sim / Não)',
      }),
      item(3, '10:00', 'facebook', 'ex04', 'Diagnóstico gratuito de gestão de pessoas', 'imagem', {
        cor: 'creme',
        legenda: 'Em poucos minutos, o diagnóstico mostra onde a gestão de pessoas da sua empresa mais precisa de atenção. Link na página.',
        notas: 'Conferir o link da página antes de publicar.',
      }),
      item(7, '09:00', 'linkedin_pessoal', 'ex05', 'Feedback que a equipe consegue usar', 'texto', {
        legenda: 'Feedback útil tem três partes: o fato, o efeito e o próximo passo. Sem o próximo passo, vira só opinião.',
      }),
      item(9, '15:00', 'instagram', 'ex06', 'Checklist de integração do primeiro dia', 'carrossel', {
        slides: 5, cor: 'manteiga', status: 'Card aprovado',
        legenda: 'O primeiro dia define muito do que a pessoa vai sentir sobre a empresa. Salve o checklist para a próxima contratação.',
      }),
    ],
  }
}

const NOME_REDE = { linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', both: 'LinkedIn e Instagram' }

function previa(p) {
  return {
    id: p.id, platform: p.platform, rede: NOME_REDE[p.platform] ?? p.platform,
    destino: p.platform === 'linkedin' && p.linkedin_organization_urn ? 'Página: Empresa de Exemplo' : 'Conta de exemplo',
    status: p.status, scheduled_at: p.scheduled_at ?? null, content: p.content, caracteres: p.content.length,
    usa_titulo: Boolean(p.titulo_documento), titulo_documento: p.titulo_documento ?? null, midias: [],
    codigo_peca: p.codigo_peca ?? null, primeiro_comentario: p.primeiro_comentario ?? null, extras_ativos: true,
  }
}

function textoGerado(topic, platform, format_type) {
  const tema = (topic || 'gestão de pessoas').trim()
  const texto = format_type === 'quote'
    ? `Sobre ${tema}: o que a liderança tolera, a equipe aprende.`
    : `${tema.charAt(0).toUpperCase()}${tema.slice(1)} começa por uma pergunta simples: o que a equipe precisa saber para decidir sem esperar o gestor?\n\n` +
      'Quando os papéis estão claros, as conversas de desempenho ficam mais curtas e mais justas.\n\n' +
      'Na sua empresa, essa pergunta já foi feita?\n\n(Texto de exemplo do modo de demonstração. Nenhuma IA foi chamada.)'
  return { platform, topic: tema, format_type, generated_text: texto, char_count: texto.length, word_count: texto.split(/\s+/).length }
}

/** Cria o servidor (sem abrir a porta). Cada servidor tem os seus próprios posts. */
export function criarApiDemo() {
  const posts = postsIniciais()
  let seq = posts.length

  const lerJson = q => new Promise(res => {
    let corpo = ''
    q.on('data', c => { corpo += c })
    q.on('end', () => { try { res(corpo ? JSON.parse(corpo) : {}) } catch { res({}) } })
  })

  return http.createServer(async (q, s) => {
    s.setHeader('Access-Control-Allow-Origin', '*')
    s.setHeader('Access-Control-Allow-Headers', '*')
    s.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    if (q.method === 'OPTIONS') { s.writeHead(204); return s.end() }

    const u = new URL(q.url, 'http://demo')
    const caminho = u.pathname.replace(/\/+$/, '')
    const metodo = q.method
    const json = (codigo, corpo) => { s.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' }); s.end(JSON.stringify(corpo)) }
    const corpo = metodo === 'POST' || metodo === 'PATCH' ? (q.headers['content-type'] || '').includes('json') ? await lerJson(q) : (q.resume(), {}) : {}

    // ── OAuth ─────────────────────────────────────────────────────────────
    if (caminho === '/api/v1/oauth/status')
      return json(200, { platforms: ['linkedin', 'instagram', 'facebook'].map(p => ({ platform: p, connected: true, is_expired: false, token_expires_at: dia(50, 0) })) })
    if (caminho === '/api/v1/oauth/linkedin/organizations')
      return json(200, { organizations: [{ urn: 'urn:li:organization:1', name: 'Empresa de Exemplo' }] })
    if (caminho === '/api/v1/oauth/instagram/conta')
      return json(200, { conectado: true, conta: 'empresa.exemplo', tipo: 'BUSINESS', pode_publicar: true, publicacoes_24h: { usadas: 1, total: 25 } })
    if (caminho === '/api/v1/oauth/facebook/conta')
      return json(200, { conectado: true, pagina: 'Empresa de Exemplo', pagina_certa: true })
    if (/^\/api\/v1\/oauth\/[a-z_]+\/start$/.test(caminho))
      return json(400, { detail: 'Na demonstração, as contas já aparecem conectadas e nenhuma rede é acessada.' })

    // ── IA ────────────────────────────────────────────────────────────────
    if (caminho === '/api/v1/ai/generate_post' && metodo === 'POST')
      return json(200, textoGerado(corpo.topic, corpo.platform, corpo.format_type))

    // ── Mídia ─────────────────────────────────────────────────────────────
    if (caminho === '/api/v1/media/upload' && metodo === 'POST')
      return json(200, { image_urls: (corpo.images_base64 || []).map((_, i) => `https://exemplo.invalid/demo/slide-${i + 1}.jpg`), pdf_url: corpo.assemble_pdf ? 'https://exemplo.invalid/demo/carrossel.pdf' : null })
    if (caminho === '/api/v1/media/upload-file' && metodo === 'POST')
      return json(200, { url: 'https://exemplo.invalid/demo/arquivo', content_type: 'application/octet-stream' })

    // ── Posts ─────────────────────────────────────────────────────────────
    if (caminho === '/api/v1/posts' && metodo === 'GET') {
      const status = u.searchParams.get('status')
      const lista = posts.filter(p => !status || p.status === status)
      return json(200, lista.sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at))))
    }
    if (caminho === '/api/v1/posts' && metodo === 'POST') {
      const p = { ...corpo, id: `ex-${++seq}`, status: corpo.scheduled_at ? 'scheduled' : 'draft', created_at: new Date().toISOString() }
      posts.push(p)
      return json(200, p)
    }
    const m = caminho.match(/^\/api\/v1\/posts\/([^/]+)(?:\/([a-z-]+))?$/)
    if (m) {
      const p = posts.find(x => x.id === m[1])
      if (!p) return json(404, { detail: 'Post não encontrado.' })
      const acao = m[2]
      if (acao === 'publish' && metodo === 'POST') {
        p.status = 'published'; p.published_at = new Date().toISOString()
        return json(200, { success: true, post_id: p.id, message: 'Demonstração: o post foi marcado como publicado, e nada foi enviado às redes.' })
      }
      if (acao === 'cancel' && metodo === 'POST') { p.status = 'draft'; p.scheduled_at = undefined; return json(200, p) }
      if (acao === 'previa' && metodo === 'GET') return json(200, previa(p))
      if (!acao && metodo === 'PATCH') {
        for (const k of ['content', 'titulo_documento', 'scheduled_at', 'codigo_peca', 'primeiro_comentario']) if (k in corpo) p[k] = corpo[k]
        return json(200, { ...previa(p), mensagem: 'Alterações salvas (só nesta demonstração).' })
      }
      if (!acao && metodo === 'GET') return json(200, p)
    }

    // ── Calendário ────────────────────────────────────────────────────────
    if (caminho === '/api/v1/calendario/espelho' && metodo === 'GET') return json(200, espelhoCalendario())

    return json(404, { detail: `Caminho sem resposta na demonstração: ${metodo} ${caminho}` })
  })
}

/** Abre a API de exemplo em 127.0.0.1 na porta dada e devolve o servidor. */
export function iniciarApiDemo(porta = PORTA_API_PADRAO) {
  const servidor = criarApiDemo()
  return new Promise((res, rej) => {
    servidor.once('error', rej)
    servidor.listen(porta, '127.0.0.1', () => res(servidor))
  })
}

// Rodando direto (node demo/api-demo.mjs): sobe só a API.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const porta = Number(process.env.DEMO_PORTA_API || PORTA_API_PADRAO)
  iniciarApiDemo(porta).then(() => console.log(`API de exemplo em http://127.0.0.1:${porta}`))
}
