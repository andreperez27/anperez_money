import assert from 'node:assert/strict'
import { calcularResumoPlanejamentos } from '../src/lib/planejamentoCalc.js'

// Testes da função pura de agregação dos Planejamentos (ETAPA 06/E3).
// Mesmo padrão simples das suítes do projeto: node direto, contador
// passou/falhou, exit code reflete o resultado.

let passou = 0
let falhou = 0

function caso(nome, fn) {
  try {
    fn()
    console.log(`ok      — ${nome}`)
    passou += 1
  } catch (err) {
    console.log(`FALHOU  — ${nome}: ${err.message}`)
    falhou += 1
  }
}

// Fábrica de itens com só o que a agregação usa.
function item(tipo_op, valor, estado = 'previsto') {
  return { tipo_op, valor, estado }
}

caso('TESTE 1 — lista vazia: totais e contagens zerados', () => {
  const { totais, contagens } = calcularResumoPlanejamentos([])
  assert.deepStrictEqual(totais, { entradas: 0, saidas: 0, resultado: 0 })
  assert.deepStrictEqual(contagens, { previsto: 0, realizado: 0, cancelado: 0 })
})

caso('TESTE 2 — somente entradas', () => {
  const { totais, contagens } = calcularResumoPlanejamentos([
    item('Entrada', 100),
    item('Entrada', 250.5),
  ])
  assert.strictEqual(totais.entradas, 350.5)
  assert.strictEqual(totais.saidas, 0)
  assert.strictEqual(totais.resultado, 350.5)
  assert.strictEqual(contagens.previsto, 2)
})

caso('TESTE 3 — somente saídas', () => {
  const { totais } = calcularResumoPlanejamentos([
    item('Saida', 80),
    item('Saida', 40),
  ])
  assert.strictEqual(totais.saidas, 120)
  assert.strictEqual(totais.entradas, 0)
  assert.strictEqual(totais.resultado, -120)
})

caso('TESTE 4 — entradas + saídas', () => {
  const { totais } = calcularResumoPlanejamentos([
    item('Entrada', 500),
    item('Saida', 180),
  ])
  assert.deepStrictEqual(totais, { entradas: 500, saidas: 180, resultado: 320 })
})

caso("TESTE 5 — cancelado NÃO entra nos totais (exemplo do modelo)", () => {
  const { totais } = calcularResumoPlanejamentos([
    item('Entrada', 1400, 'previsto'),
    item('Saida', 620, 'previsto'),
    item('Saida', 300, 'cancelado'),
  ])
  assert.strictEqual(totais.entradas, 1400)
  assert.strictEqual(totais.saidas, 620)
  assert.strictEqual(totais.resultado, 780)
})

caso('TESTE 6 — cancelado ENTRA na contagem', () => {
  const { contagens } = calcularResumoPlanejamentos([
    item('Entrada', 1400, 'previsto'),
    item('Saida', 620, 'previsto'),
    item('Saida', 300, 'cancelado'),
  ])
  assert.deepStrictEqual(contagens, { previsto: 2, realizado: 0, cancelado: 1 })
})

caso('TESTE 7 — resultado positivo', () => {
  const { totais } = calcularResumoPlanejamentos([
    item('Entrada', 900),
    item('Saida', 400),
  ])
  assert.strictEqual(totais.resultado, 500)
  assert.ok(totais.resultado > 0)
})

caso('TESTE 8 — resultado negativo', () => {
  const { totais } = calcularResumoPlanejamentos([
    item('Entrada', 200),
    item('Saida', 650),
  ])
  assert.strictEqual(totais.resultado, -450)
  assert.ok(totais.resultado < 0)
})

caso('TESTE 9 — mistura previsto/realizado/cancelado (contagens e totais)', () => {
  const { totais, contagens } = calcularResumoPlanejamentos([
    item('Entrada', 1000, 'previsto'),
    item('Saida', 200, 'previsto'),
    item('Saida', 100, 'previsto'),
    item('Entrada', 500, 'realizado'),
    item('Saida', 150, 'realizado'),
    item('Saida', 300, 'cancelado'),
  ])
  // Contagem conta TUDO, independente dos totais.
  assert.deepStrictEqual(contagens, { previsto: 3, realizado: 2, cancelado: 1 })
  // Totais somam previsto + realizado; cancelado fica de fora.
  assert.strictEqual(totais.entradas, 1500)
  assert.strictEqual(totais.saidas, 450)
  assert.strictEqual(totais.resultado, 1050)
})

caso('TESTE 10 — valores com centavos (somas exatas)', () => {
  // 0.75 / 0.25 / 0.50 são exatos em ponto flutuante — strict seguro.
  const { totais, contagens } = calcularResumoPlanejamentos([
    item('Entrada', 1400.75, 'previsto'),
    item('Entrada', 0.25, 'realizado'),
    item('Saida', 620.5, 'previsto'),
    item('Saida', 0.25, 'cancelado'), // fora dos totais
  ])
  assert.strictEqual(totais.entradas, 1401)
  assert.strictEqual(totais.saidas, 620.5)
  assert.strictEqual(totais.resultado, 780.5)
  assert.deepStrictEqual(contagens, { previsto: 2, realizado: 1, cancelado: 1 })
})

console.log('')
console.log(`${passou} ok, ${falhou} falharam`)
if (falhou > 0) process.exit(1)
