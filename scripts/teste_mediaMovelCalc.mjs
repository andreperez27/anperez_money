import assert from 'node:assert/strict'
import { calcularMediaMovel } from '../src/lib/mediaMovelCalc.js'

// ============================================================================
// Testes da MÉDIA MÓVEL (ETAPA 06/P5) — lib pura de pré-preenchimento.
// Rodar: node scripts/teste_mediaMovelCalc.mjs
// ============================================================================

let ok = 0
let falhou = 0

function teste(nome, fn) {
  try {
    fn()
    ok += 1
    console.log(`ok      — ${nome}`)
  } catch (e) {
    falhou += 1
    console.log(`FALHOU  — ${nome}`)
    console.log(`        ${e.message}`)
  }
}

function lancaErro(fn, trecho) {
  assert.throws(fn, (e) => e instanceof Error && e.message.includes(trecho))
}

// --- Comportamento básico -------------------------------------------------

teste('média simples com janela padrão 3', () => {
  assert.equal(calcularMediaMovel({ historico: [10, 20, 30] }), 20)
})

teste('janela 2 usa apenas os 2 últimos', () => {
  assert.equal(calcularMediaMovel({ historico: [10, 20, 30], janela: 2 }), 25)
})

teste('um único valor vira a própria média', () => {
  assert.equal(calcularMediaMovel({ historico: [5] }), 5)
})

teste('histórico vazio devolve 0 (sem erro)', () => {
  assert.equal(calcularMediaMovel({ historico: [] }), 0)
})

teste('janela maior que o histórico usa todos os valores', () => {
  assert.equal(calcularMediaMovel({ historico: [40, 50], janela: 5 }), 45)
})

teste('ignora valores não numéricos e trabalha com os numéricos', () => {
  assert.equal(calcularMediaMovel({ historico: ['abc', 10, 20, undefined] }), 15)
})

teste('ordem cronológica preservada pelo slice do fim', () => {
  const r = calcularMediaMovel({ historico: [100, 200, 300, 400], janela: 2 })
  assert.equal(r, 350) // (300 + 400) / 2
})

teste('arredonda para centavos (evita 1463.1699...)', () => {
  const r = calcularMediaMovel({ historico: [100.1, 200.2, 300.3] })
  assert.equal(r, 200.2) // (100.1+200.2+300.3)/3 = 200.1999... → 200.2
})

// --- Validação de argumentos ----------------------------------------------

teste('janela não-inteira lança erro claro', () => {
  lancaErro(() => calcularMediaMovel({ historico: [1, 2], janela: 2.5 }), 'inteira')
})

teste('janela zero lança erro claro', () => {
  lancaErro(() => calcularMediaMovel({ historico: [1, 2], janela: 0 }), 'inteira')
})

teste('historico não-lista lança erro claro', () => {
  lancaErro(() => calcularMediaMovel({ historico: '10,20' }), 'lista')
})

teste('chamada sem argumentos devolve 0', () => {
  assert.equal(calcularMediaMovel(), 0)
})

console.log(`\n${ok} testes passaram, ${falhou} falharam.`)
if (falhou > 0) process.exit(1)
