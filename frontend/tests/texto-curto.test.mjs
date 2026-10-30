// Testes da prévia de texto das listas. Rodar: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cortarEmPalavra, previaPrimeiraLinha } from '../lib/textoCurto.ts'

const POST = 'Turnover alto raramente é um problema de salário. Na maioria das empresas que crescem rápido, o que falta é clareza.'

test('texto curto fica igual, sem reticência', () => {
  assert.equal(cortarEmPalavra('Frase da semana.', 80), 'Frase da semana.')
})

test('corte termina em palavra inteira, seguido de reticência', () => {
  const r = cortarEmPalavra(POST, 80)
  assert.equal(r, 'Turnover alto raramente é um problema de salário. Na maioria das empresas que…')
  assert.ok(r.length <= 81)
})

test('quando o limite cai logo depois de uma palavra, ela fica', () => {
  assert.equal(cortarEmPalavra('uma duas três quatro', 8), 'uma duas…')
})

test('sem pontuação solta antes da reticência', () => {
  assert.equal(cortarEmPalavra('Carrossel: cinco sinais, arraste para ver', 25), 'Carrossel: cinco sinais…')
  assert.equal(cortarEmPalavra('Problema de salário. Na maioria', 21), 'Problema de salário…')
})

test('palavra única maior que o limite é cortada no limite', () => {
  assert.equal(cortarEmPalavra('a'.repeat(30), 10), `${'a'.repeat(10)}…`)
})

test('prévia usa a primeira linha com conteúdo', () => {
  assert.equal(previaPrimeiraLinha('\n  \nTítulo do post\nresto', 80), 'Título do post')
})
