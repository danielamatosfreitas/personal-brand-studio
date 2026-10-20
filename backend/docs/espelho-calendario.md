# Espelho do Calendário no app (especificação, 20/10/2026)

Página **Calendário** do Personal Brand OS: cópia só de leitura do calendário oficial, para a Dani conferir os textos pelo celular.

## Princípio

- O calendário oficial continua sendo `MARKETING\Calendario_Editorial_Final.html`, mantido pela sessão Calendário.
- O app guarda só um espelho, enviado pelo Calendário, e **nunca edita nada**.
- Toda tela da página mostra "Atualizado em dd/mm às hh:mm", a partir do campo `gerado_em`.
- O espelho fica no armazenamento de arquivos do app (o mesmo bucket da mídia), sem tabela no banco:
  - `calendario/espelho.json`: a versão atual;
  - `calendario/espelho-anterior.json`: a versão de antes do último envio.

## Como a sessão Calendário envia

1. Gerar o arquivo `calendario-espelho.json` no formato abaixo, em UTF-8.
2. Rodar, na pasta `C:\projetos\PERSONALBRAND`:

   ```
   python scripts/enviar_espelho_calendario.py "C:\caminho\calendario-espelho.json"
   ```

3. O script lê a chave do arquivo local `.sync_token` (ignorado pelo Git) e manda o arquivo para `POST /api/v1/calendario/espelho`, com a chave no cabeçalho `X-Sync-Token`. A chave nunca aparece na tela, no terminal nem em relatório.
4. Resposta de sucesso: `Espelho enviado: N itens, gerado em …, recebido em …`. Se o formato estiver errado, o envio é recusado com a lista dos erros, e o espelho anterior continua no ar.

Quando enviar: depois de cada mudança no calendário que mexa em data, hora, texto ou status de uma publicação.

## Formato do `calendario-espelho.json`

```json
{
  "versao": 1,
  "gerado_em": "2026-10-20T12:00:00-03:00",
  "fonte": "Calendario_Editorial_Final.html",
  "itens": [
    {
      "id": "2026-10-28-pt105-linkedin-empresa",
      "data": "2026-10-28",
      "hora": "12:00",
      "rede": "linkedin_empresa",
      "codigo": "pt105",
      "titulo": "A conta do fim da 6x1 numa loja pequena",
      "formato": "pdf",
      "slides": 8,
      "cor": "verde",
      "status": "Card aprovado",
      "legenda": "texto completo, com as quebras de linha (\n) e hashtags",
      "primeiro_comentario": "texto completo",
      "titulo_documento": "A conta do fim da 6x1 numa loja pequena",
      "roteiro": null,
      "notas": null
    }
  ]
}
```

Exemplo completo: `docs/exemplo-calendario-espelho.json` (textos do `Textos_dos_Cards.txt`).

### Campos do arquivo

| Campo | Obrigatório | Formato |
|---|---|---|
| `versao` | sim | sempre `1` |
| `gerado_em` | sim | data e hora em que o Calendário gerou o arquivo, com fuso: `2026-10-20T12:00:00-03:00`. É o "Atualizado em" da página. |
| `fonte` | não | de onde saiu (ex.: `Calendario_Editorial_Final.html`) |
| `itens` | sim | lista de publicações, no máximo 3000 |

### Campos de cada item

| Campo | Obrigatório | Formato |
|---|---|---|
| `id` | sim | id da linha, único no arquivo e estável entre envios (sugestão: `data-codigo-rede`, ex.: `2026-10-27-pt105-instagram`); até 120 caracteres |
| `data` | sim | `AAAA-MM-DD` |
| `hora` | não | `HH:MM`, horário de Brasília; `null` quando não houver hora (Stories) |
| `rede` | sim | `linkedin_pessoal`, `linkedin_empresa`, `instagram`, `facebook` ou `stories` |
| `codigo` | não | código da peça como no calendário (`pt105`, `C2 #09`, `Peça 17`); até 40 caracteres |
| `titulo` | sim | título da publicação; até 300 caracteres |
| `formato` | não | `carrossel`, `card`, `pdf`, `reel`, `texto`, `stories`, `imagem` ou `video` |
| `slides` | não | número de slides (1 a 20), para mostrar "8 slides" |
| `cor` | não | cor de fundo (`verde`, `creme`, `manteiga`, `terracota`) |
| `status` | não | texto do status como no calendário (ex.: `Texto aprovado`, `Card aprovado`, `Agendado`, `Publicado`); até 120 caracteres |
| `legenda` | não | texto completo da legenda ou do post |
| `primeiro_comentario` | não | texto completo |
| `titulo_documento` | não | título do documento (PDF no LinkedIn); até 300 caracteres |
| `roteiro` | não | roteiro do Reel ou dos Stories |
| `notas` | não | observações para a Dani (ex.: tarefa antes de publicar) |

Regras:

- Textos (`legenda`, `primeiro_comentario`, `roteiro`, `notas`) com até 20.000 caracteres cada, exatamente como no calendário: o app mostra e copia sem mudar nada.
- Campo sem valor: `null` ou ausente.
- Campos a mais são ignorados (podem ser acrescentados no futuro sem quebrar o envio).
- Arquivo com até 5 MB.
- A página mostra os itens de hoje em diante (data de Brasília); itens passados podem ir no arquivo, mas não aparecem.

## Página Calendário (app)

- Menu lateral, abaixo de "Agendados". Pensada primeiro para celular.
- Lista de hoje em diante, agrupada por semana (segunda a domingo).
- Cada item mostra: data, hora, rede (com ícone), código da peça, título, cor de fundo, status e formato ("8 slides", "PDF", "Reel", "Texto", "Stories"). Nesta primeira versão, sem imagens.
- Ao tocar, abre o texto completo: legenda, primeiro comentário, título do documento, roteiro e notas, quando houver, cada campo com o botão "Copiar".
- Filtros por rede: LinkedIn pessoal, LinkedIn empresa, Instagram, Facebook e Stories.

## Chave de sincronização (CALENDARIO_SYNC_TOKEN)

- A chave fica no arquivo local `C:\projetos\PERSONALBRAND\.sync_token`, ignorado pelo Git, e na variável `CALENDARIO_SYNC_TOKEN` do serviço `personal-brand-os` no Railway.
- Sem a variável no Railway, o envio fica fechado (o servidor responde que o envio ainda não foi configurado).
- A página do app lê o espelho com a senha do app, como as outras telas; a chave de sincronização só serve para enviar.
- Para trocar a chave: gerar um valor novo no `.sync_token` e atualizar a variável no Railway com o mesmo valor.

Passo a passo para criar a variável no Railway:

1. Abrir as variáveis do serviço: https://railway.com/project/12baae2a-3022-4648-baa3-9693eff00d5e/service/5efaf040-b95a-4eab-8ed4-fda885b7eaac/variables?environmentId=70bc84b9-0e5c-415e-ad0b-ab5025770f29
2. No Explorador do Windows, abrir `C:\projetos\PERSONALBRAND`, clicar com o botão direito em `.sync_token`, escolher "Abrir com" e "Bloco de Notas". Selecionar tudo (Ctrl+A) e copiar (Ctrl+C). Fechar o Bloco de Notas sem salvar.
3. No Railway, clicar em "New Variable". Em nome, escrever `CALENDARIO_SYNC_TOKEN`; em valor, colar (Ctrl+V). Clicar em "Add".
4. Clicar em "Deploy" (ou "Apply changes") para o serviço reiniciar com a variável. Evitar perto dos horários de posts agendados (9h, 12h e 15h).
