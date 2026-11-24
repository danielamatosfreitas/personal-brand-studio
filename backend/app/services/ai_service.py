"""
app/services/ai_service.py
Motor de IA — Fase 2.3: System Prompt dinâmico por plataforma.
LinkedIn: profundo, analítico, autoridade executiva.
Instagram: curto, direto, "voadora elegante".
"""
import httpx
import os

# ── Persona Base ───────────────────────────────────────────────────────────────
# O texto de quem é a pessoa autora (cargo, formação, tese, regras de escrita) fica fora do código,
# num arquivo de configuração: PERSONA_FILE (padrão config/persona.txt). Sem ele, vale o exemplo
# genérico config/persona.example.txt. O config/persona.txt real não vai para o Git.

_CONFIG = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "config")


def carregar_persona() -> str:
    caminho = os.environ.get("PERSONA_FILE") or os.path.join(_CONFIG, "persona.txt")
    if not os.path.exists(caminho):
        caminho = os.path.join(_CONFIG, "persona.example.txt")
    with open(caminho, encoding="utf-8") as f:
        return f.read().strip()


PERSONA_BASE = carregar_persona()


# ── Diretrizes por Plataforma ──────────────────────────────────────────────────

LINKEDIN_DIRECTIVES = """
PLATAFORMA: LinkedIn
OBJETIVO: Gerar autoridade executiva e posicionamento analítico.

ESTRUTURA OBRIGATÓRIA:
1. ABERTURA (1 frase): afirmação direta e contraintuitiva que para o scroll.
   Exemplo de padrão: "Turnover alto raramente é um problema de salário."
   Não revele a conclusão. Gere tensão intelectual.

2. ÂNCORA PRÁTICA (1 parágrafo curto): traga um cenário real de consultoria.
   Use frases como:
   "Em um diagnóstico recente com uma empresa de médio porte..."
   "Quando atendo organizações com esse sintoma, o padrão é sempre o mesmo..."
   "Na última reestruturação que conduzi..."
   Isso ancora o texto em experiência real, não em teoria.

3. CAUSA RAIZ (1 a 2 parágrafos): explique o problema real, mais profundo que o aparente.
   Vá além do óbvio. Mostre o que está por baixo da superfície.
   Use dados quando relevante (Gallup, McKinsey, ou experiência própria).

4. ARQUITETURA DA SOLUÇÃO (1 parágrafo): apresente a direção de solução com base em
   estrutura organizacional, cultura e liderança. Não dê um passo a passo genérico.
   Dê uma perspectiva de quem enxerga o sistema inteiro.

5. FECHAMENTO (1 pergunta ou provocação): gere reflexão. A pergunta deve ser
   específica o suficiente para provocar comentários de quem viveu isso.

FORMATO:
- Parágrafos curtos (máximo 3 linhas cada)
- Tamanho total: 180 a 280 palavras
- Máximo 3 hashtags específicas ao final (nunca genéricas como #RH ou #Gestão)
- ZERO links no corpo do texto
""".strip()

INSTAGRAM_DIRECTIVES = """
PLATAFORMA: Instagram
OBJETIVO: Impacto imediato, salvamentos e compartilhamentos via DM.

ESTILO: "Voadora elegante". Curto, preciso, sem enrolação.
Pense em quem vai ler isso no feed em 8 segundos. Ou para ou não.

ESTRUTURA OBRIGATÓRIA:
1. PRIMEIRA LINHA (até 10 palavras): frase de impacto que para o scroll.
   Deve funcionar como uma sentença autônoma. Sem vírgulas longas.
   Exemplos de padrão:
   "Gestor bom no técnico não é gestor bom em pessoas."
   "Empresa não perde funcionário. Perde ambiente."
   "Alta rotatividade é sintoma. A causa está um nível acima."

2. PROBLEMA (2 a 3 frases): exponha o problema de gestão de forma direta.
   Sem introdução. Sem contexto desnecessário. Vá direto ao ponto.
   Use linguagem do cotidiano corporativo, não acadêmica.

3. VIRADA (1 a 2 frases): entregue o insight ou reframe que muda a perspectiva.
   Essa é a frase que as pessoas salvam.

4. PERGUNTA FINAL (1 frase): pergunta que provoca identificação e gera resposta.
   Exemplos: "Você já viveu isso como liderado ou como gestor?"
   "Na sua empresa, isso é tratado como causa ou como sintoma?"

FORMATO:
- Tamanho total: 70 a 120 palavras
- Máximo 3 emojis, apenas para separar seções se necessário
- 4 a 5 hashtags de nicho ao final
- Tom: próximo, mas com autoridade. Como uma conversa direta entre executivas.
""".strip()

LINKEDIN_CAROUSEL_DIRECTIVES = """
PLATAFORMA: LinkedIn (Carrossel PDF)
OBJETIVO: Conteúdo educativo de alta densidade que gera saves e repost.

QUANTIDADE DE SLIDES: decida entre 3 e 9 slides com base na complexidade real do tema.
- Tema simples ou uma ideia central única: 3 a 5 slides (capa + 1-3 pontos + fechamento)
- Tema com framework, lista de erros, ou processo: 6 a 9 slides
- Nunca infle artificialmente. Cada slide deve carregar uma ideia que merece existir sozinha.

ESTRUTURA OBRIGATÓRIA:

SLIDE 1 (CAPA): Título de até 8 palavras que gera tensão ou curiosidade.
Subtítulo opcional com contexto (1 linha, tom editorial/itálico).
Padrão: "X erros que...", "Por que X acontece...", "O que ninguém fala sobre..."

SLIDES INTERMEDIÁRIOS (CONTEÚDO):
Cada slide deve ter:
- Título curto (3 a 5 palavras, sem verbo de ação genérico)
- 2 a 3 linhas de conteúdo denso e prático
- Um dado, exemplo ou lista quando aplicável
Progressão lógica: contexto → problema → causa → solução → aplicação

ÚLTIMO SLIDE (CTA):
Pergunta que convida comentários + frase de reforço de autoridade.
Exemplo: "Qual desses pontos você reconhece na sua organização?"
Não peça para seguir. Peça para refletir e comentar.

FORMATO DE ENTREGA:
Liste cada slide exatamente como:
SLIDE 1:
[conteúdo]
---
SLIDE 2:
[conteúdo]
---

TAMANHO: cada slide máximo 40 palavras de conteúdo (além do título).
TOM: executivo, direto, sem bullet points genéricos.
""".strip()

INSTAGRAM_CAROUSEL_DIRECTIVES = """
PLATAFORMA: Instagram (Carrossel)
OBJETIVO: Conteúdo educativo direto que gera saves e compartilhamento via DM.

QUANTIDADE DE SLIDES: decida entre 3 e 9 slides com base na complexidade real do tema.
- Tema simples ou uma ideia central única: 3 a 5 slides (capa + 1-3 pontos + fechamento)
- Tema com framework, lista de erros, ou processo: 6 a 9 slides
- Nunca infle artificialmente. Cada slide deve carregar uma ideia que merece existir sozinha.

ESTRUTURA OBRIGATÓRIA:

SLIDE 1 (CAPA): Frase de até 8 palavras que para o scroll, ritmo de fala, não de texto corrido.
Subtítulo opcional (1 linha) aumentando a curiosidade.
Padrão: "X erros que...", "O que ninguém te conta sobre...", "Pare de fazer X."

SLIDES INTERMEDIÁRIOS (CONTEÚDO):
Cada slide deve ter:
- Título curto (3 a 5 palavras, direto, sem verbo de ação genérico)
- 2 a 3 linhas de conteúdo, tom "voadora elegante": curto, sem enrolação, do cotidiano corporativo
Progressão lógica: contexto → problema → causa → solução → aplicação

ÚLTIMO SLIDE (CTA):
Pergunta que provoca identificação e convida a comentar.
Exemplo: "Você já viveu isso na sua empresa?"
Não peça para seguir. Peça para refletir e comentar.

FORMATO DE ENTREGA:
Liste cada slide exatamente como:
SLIDE 1:
[conteúdo]
---
SLIDE 2:
[conteúdo]
---

TAMANHO: cada slide máximo 30 palavras de conteúdo (além do título).
TOM: próximo, direto, autoridade sem academicismo.
""".strip()

INSTAGRAM_QUOTE_DIRECTIVES = """
PLATAFORMA: Instagram (Quote Card)
OBJETIVO: Uma frase isolada de alto impacto para card visual único.

ESTRUTURA:
Gere UMA frase ou duas frases curtas conectadas (máximo 35 palavras no total),
que funcione como citação editorial isolada em um card visual.

A frase deve:
- Ter ritmo de fala, não de texto corrido
- Conter uma virada ou contraste (não é apenas uma afirmação plana)
- Funcionar sozinha, sem contexto adicional
- Ser memorável o suficiente para ser salva e compartilhada

Padrão de referência (não copie, use como calibração de tom):
"Empresa não perde funcionário. Perde ambiente."
"Liderança não se delega. Se desenvolve."
"Cultura não é o que está na parede. É o que se tolera todos os dias."

FORMATO DE SAÍDA: apenas a frase final, sem aspas, sem explicação.
""".strip()


class AIServiceError(Exception):
    pass


def _build_system_prompt(platform: str, format_type: str) -> str:
    """
    Constrói o system prompt completo combinando a persona base
    com as diretrizes específicas da plataforma e formato.
    """
    if platform == "instagram" and format_type == "quote":
        directives = INSTAGRAM_QUOTE_DIRECTIVES
    elif platform == "instagram" and format_type == "carousel":
        directives = INSTAGRAM_CAROUSEL_DIRECTIVES
    elif platform == "instagram":
        directives = INSTAGRAM_DIRECTIVES
    elif platform == "linkedin" and format_type == "carousel":
        directives = LINKEDIN_CAROUSEL_DIRECTIVES
    else:
        directives = LINKEDIN_DIRECTIVES

    return f"{PERSONA_BASE}\n\n{'='*60}\n\n{directives}"


async def generate_post(topic: str, platform: str, format_type: str = "text") -> str:
    """
    Gera conteúdo profissional com system prompt dinâmico por plataforma.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise AIServiceError(
            "ANTHROPIC_API_KEY não configurada. "
            "Adicione a variável de ambiente no Railway."
        )

    platform_lower = platform.lower()
    if platform_lower not in ("linkedin", "instagram"):
        raise AIServiceError(
            f"Plataforma '{platform}' não suportada. Use 'linkedin' ou 'instagram'."
        )

    system_prompt = _build_system_prompt(platform_lower, format_type)

    # Prompt do usuário — simples e direto para deixar o system prompt trabalhar
    user_prompt = f"""Crie o conteúdo para o seguinte tema:

TEMA: {topic}

Gere apenas o texto final, pronto para publicação.
Sem títulos como "Post:", "Rascunho:" ou explicações adicionais.
Escreva na primeira pessoa, como se fosse a pessoa autora escrevendo diretamente.
Lembre: NUNCA use travessão (—). Use vírgula ou ponto."""

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-sonnet-4-6",
                    "max_tokens": 1500,
                    "system": system_prompt,
                    "messages": [
                        {"role": "user", "content": user_prompt}
                    ],
                },
            )
        except httpx.TimeoutException:
            raise AIServiceError("Timeout na comunicação com a Anthropic. Tente novamente.")
        except httpx.RequestError as e:
            raise AIServiceError(f"Erro de conexão: {str(e)}")

    if response.status_code == 401:
        raise AIServiceError("ANTHROPIC_API_KEY inválida. Verifique no Railway > Variables.")
    if response.status_code == 429:
        raise AIServiceError("Limite de requisições atingido. Aguarde alguns segundos.")
    if response.status_code != 200:
        raise AIServiceError(
            f"Anthropic retornou erro {response.status_code}: {response.text}"
        )

    data = response.json()
    try:
        return data["content"][0]["text"].strip()
    except (KeyError, IndexError) as e:
        raise AIServiceError(f"Resposta inesperada da Anthropic: {str(e)}")
