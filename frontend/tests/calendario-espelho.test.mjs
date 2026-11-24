// Testes da página Calendário (espelho só de leitura, 20/10). Rodar: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  atualizadoEm, camposDeTexto, dataCurta, hojeBrasilia, porSemana, rotuloFormato, segundaDaSemana,
} from '../lib/calendarioEspelho.ts'

const exemplo = JSON.parse(readFileSync(new URL('./fixtures/exemplo-calendario-espelho.json', import.meta.url), 'utf8'))

test('hoje no horário de Brasília (23h30 de Brasília ainda é o mesmo dia)', () => {
  assert.equal(hojeBrasilia(new Date('2026-10-21T02:30:00Z')), '2026-10-20')
  assert.equal(hojeBrasilia(new Date('2026-10-21T03:30:00Z')), '2026-10-21')
})

test('semana de segunda a domingo', () => {
  assert.equal(segundaDaSemana('2026-10-26'), '2026-10-26')
  assert.equal(segundaDaSemana('2026-11-01'), '2026-10-26')
  assert.equal(segundaDaSemana('2026-10-22'), '2026-10-19')
})

test('rótulos de data, atualização e formato', () => {
  assert.equal(dataCurta('2026-10-27'), 'Ter, 27/10')
  assert.equal(dataCurta('2026-10-24'), 'Sáb, 24/10')
  assert.equal(atualizadoEm('2026-10-20T12:00:00-03:00'), 'Atualizado em 20/10 às 12:00')
  assert.equal(atualizadoEm('2026-10-20T15:05:00Z'), 'Atualizado em 20/10 às 12:05')
  assert.equal(rotuloFormato({ formato: 'carrossel', slides: 8 }), '8 slides')
  assert.equal(rotuloFormato({ formato: 'pdf', slides: 8 }), 'PDF')
  assert.equal(rotuloFormato({ formato: 'reel' }), 'Reel')
})

test('de hoje em diante, por semana, em ordem de data e hora', () => {
  const semanas = porSemana(exemplo.itens, '2026-10-23')
  assert.deepEqual(semanas.map(s => s.rotulo), ['Semana de 19/10 a 25/10', 'Semana de 26/10 a 01/11'])
  assert.deepEqual(semanas[0].itens.map(i => i.id), ['2026-10-23-stories-texto'])
  assert.deepEqual(semanas[1].itens.map(i => i.id), [
    '2026-10-26-pt106-linkedin-pessoal', '2026-10-27-pt105-instagram', '2026-10-27-pt105-facebook', '2026-10-28-pt105-linkedin-empresa',
  ])
})

test('filtro por rede', () => {
  const s = porSemana(exemplo.itens, '2026-10-20', 'linkedin_empresa')
  assert.equal(s.length, 1)
  assert.deepEqual(s[0].itens.map(i => i.codigo), ['pt105'])
  assert.equal(porSemana(exemplo.itens, '2026-10-20', 'stories').flatMap(x => x.itens).length, 2)
})

test('texto completo: só os campos com conteúdo, exatamente como vieram', () => {
  const li = exemplo.itens.find(i => i.rede === 'linkedin_empresa')
  const campos = camposDeTexto(li)
  assert.deepEqual(campos.map(c => c.rotulo), ['Legenda', 'Primeiro comentário', 'Título do documento'])
  assert.equal(campos[0].texto, li.legenda)
  assert.ok(campos[0].texto.includes('\n\n#JornadaDeTrabalho'))
})
