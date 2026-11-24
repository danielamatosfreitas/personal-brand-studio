// Testes da opção "Instagram + Facebook" (Fase 4). Rodar: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { porRede, redesDe, resumo, soImagens } from '../lib/publicarRedes.ts'

test('Instagram + Facebook vira duas redes, na ordem', () => {
  assert.deepEqual(redesDe('instagram+facebook'), ['instagram', 'facebook'])
  assert.deepEqual(redesDe('facebook'), ['facebook'])
  assert.equal(soImagens('instagram+facebook'), true)
  assert.equal(soImagens('facebook'), true)
  assert.equal(soImagens('linkedin'), false)
})

test('falha no Instagram não cancela o Facebook', async () => {
  const chamadas = []
  const r = await porRede(['instagram', 'facebook'], async rede => {
    chamadas.push(rede)
    if (rede === 'instagram') throw new Error('O Instagram recusou o pedido')
    return 'post-fb-1'
  })
  assert.deepEqual(chamadas, ['instagram', 'facebook'])
  assert.deepEqual(r, [
    { rede: 'instagram', ok: false, erro: 'O Instagram recusou o pedido' },
    { rede: 'facebook', ok: true, id: 'post-fb-1' },
  ])
  const aviso = resumo(r, 'publicado')
  assert.equal(aviso.tipo, 'error')
  assert.match(aviso.texto, /Instagram: não deu certo \(O Instagram recusou o pedido\)\. Facebook: publicado\./)
})

test('falha no Facebook não cancela o Instagram', async () => {
  const r = await porRede(['instagram', 'facebook'], async rede => {
    if (rede === 'facebook') throw new Error('sem conexão')
    return 'post-ig-1'
  })
  assert.equal(r[0].ok, true)
  assert.equal(r[1].ok, false)
})

test('as duas dão certo', async () => {
  const r = await porRede(['instagram', 'facebook'], async rede => `id-${rede}`)
  assert.deepEqual(resumo(r, 'agendado'), { texto: 'Instagram: agendado. Facebook: agendado.', tipo: 'success' })
})

test('uma rede só mantém o aviso de sempre', async () => {
  const r = await porRede(['facebook'], async () => 'x')
  assert.deepEqual(resumo(r, 'publicado'), { texto: 'Publicado no Facebook.', tipo: 'success' })
})
