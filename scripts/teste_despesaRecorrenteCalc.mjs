import assert from 'node:assert/strict'
import {
  calcularTotalCondominio,
  montarObservacaoCondominio,
  formatarMoedaBR,
} from '../src/lib/despesaRecorrenteCalc.js'

// Testes do gerador de condomínio (ETAPA 06 / gerador de despesa recorrente).
// Mesmo padrão das suítes do projeto: node direto, contador passou/falhou,
// exit code reflete o resultado.

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

// Fábrica de item (campo mínimo usado pelo cálculo).
function item(cod, descricao, valor, inicio, termino = null, categoria = '') {
  return { cod, descricao, valor, vigencia_inicio: inicio, vigencia_termino: termino, categoria }
}

caso('TESTE 1 — sem itens: total é só gás + água (com linhas variáveis)', () => {
  const { total, detalhamento } = calcularTotalCondominio({ itens: [], mes: '2026-09', gas: 124.08, agua: 160.99 })
  assert.strictEqual(total, 285.07)
  assert.strictEqual(detalhamento.length, 2)
  assert.strictEqual(detalhamento[0].cod, '1010')
  assert.strictEqual(detalhamento[0].descricao, 'Consumo de Gás')
  assert.strictEqual(detalhamento[0].valor, 124.08)
  assert.strictEqual(detalhamento[1].cod, '1052')
})

caso('TESTE 2 — itens fixos sem fim previsto entram sem referência', () => {
  const { total, detalhamento } = calcularTotalCondominio({
    itens: [item('1002', 'Cota Condominial', 840.82, '2026-04-01', null)],
    mes: '2026-09',
    gas: 0,
    agua: 0,
  })
  assert.strictEqual(total, 840.82)
  const cota = detalhamento.find((l) => l.cod === '1002')
  assert.ok(cota)
  assert.strictEqual(cota.referencia, '')
})

caso('TESTE 3 — série Benfeitorias: referência 33/36 em SET/2026', () => {
  const { detalhamento } = calcularTotalCondominio({
    itens: [item('2002', 'Benfeitorias', 46, '2024-01-01', '2026-12-31')],
    mes: '2026-09',
    gas: 0,
    agua: 0,
  })
  const b = detalhamento.find((l) => l.cod === '2002')
  assert.strictEqual(b.referencia, '33/36')
})

caso('TESTE 4 — série Manut. Pintura PC: referência 9/24 em SET/2026', () => {
  const { detalhamento } = calcularTotalCondominio({
    itens: [item('15002', 'Manut. Pintura PC', 170, '2026-01-01', '2027-12-31')],
    mes: '2026-09',
    gas: 0,
    agua: 0,
  })
  const m = detalhamento.find((l) => l.cod === '15002')
  assert.strictEqual(m.referencia, '9/24')
})

caso('TESTE 5 — item com vigência futura NÃO entra', () => {
  const { detalhamento } = calcularTotalCondominio({
    itens: [item('9999', 'Futura', 10, '2027-01-01', null)],
    mes: '2026-09',
    gas: 0,
    agua: 0,
  })
  assert.ok(!detalhamento.some((l) => l.cod === '9999'))
})

caso('TESTE 6 — item com vigência já encerrada NÃO entra', () => {
  const { detalhamento } = calcularTotalCondominio({
    itens: [item('1002', 'Cota Condominial', 800.19, '2024-01-01', '2026-03-31')],
    mes: '2026-09',
    gas: 0,
    agua: 0,
  })
  assert.ok(!detalhamento.some((l) => l.cod === '1002'))
})

caso('TESTE 7 — troca de taxa mantém histórico: linha de abr entra, de mar não (mês abr)', () => {
  const { total, detalhamento } = calcularTotalCondominio({
    itens: [
      item('1002', 'Cota Condominial', 800.19, '2024-01-01', '2026-03-31'),
      item('1002', 'Cota Condominial', 840.82, '2026-04-01', null),
    ],
    mes: '2026-04',
    gas: 0,
    agua: 0,
  })
  assert.strictEqual(total, 840.82)
  assert.strictEqual(detalhamento.filter((l) => l.cod === '1002').length, 1)
})

caso('TESTE 8 — mes passado usa o valor antigo (histórico preservado)', () => {
  const { total } = calcularTotalCondominio({
    itens: [
      item('1002', 'Cota Condominial', 800.19, '2024-01-01', '2026-03-31'),
      item('1002', 'Cota Condominial', 840.82, '2026-04-01', null),
    ],
    mes: '2026-03',
    gas: 0,
    agua: 0,
  })
  assert.strictEqual(total, 800.19)
})

caso('TESTE 9 — total soma fixos vigentes + variáveis (SET/2026 da planilha)', () => {
  const { total } = calcularTotalCondominio({
    itens: [
      item('1002', 'Cota Condominial', 840.82, '2026-04-01', null),
      item('1050', 'Taxa de Coleta', 70.76, '2026-06-01', null),
      item('15002', 'Manut. Pintura PC', 170, '2026-01-01', '2027-12-31'),
      item('3002', 'Fundo de Reserva', 42.04, '2026-04-01', null),
      item('1102', 'Leitura de Água e Gás', 8.48, '2024-01-01', null),
      item('2002', 'Benfeitorias', 46, '2024-01-01', '2026-12-31'),
    ],
    mes: '2026-09',
    gas: 124.08,
    agua: 160.99,
  })
  // 840,82 + 70,76 + 170 + 42,04 + 8,48 + 46 + 124,08 + 160,99 = 1463,17
  assert.strictEqual(total, 1463.17)
})

caso('TESTE 10 — observação: uma linha por item com valor em R$', () => {
  const { detalhamento } = calcularTotalCondominio({
    itens: [item('15002', 'Manut. Pintura PC', 170, '2026-01-01', '2027-12-31')],
    mes: '2026-09',
    gas: 124.08,
    agua: 0,
  })
  const texto = montarObservacaoCondominio(detalhamento)
  const linhas = texto.split('\n')
  assert.ok(linhas.some((l) => l === '15002 Manut. Pintura PC 9/24 R$ 170,00'))
  assert.ok(linhas.some((l) => l === '1010 Consumo de Gás R$ 124,08'))
})

caso('TESTE 11 — formatarMoedaBR: pt-BR com milhar e vírgula', () => {
  assert.strictEqual(formatarMoedaBR(1463.17), 'R$ 1.463,17')
  assert.strictEqual(formatarMoedaBR(0), 'R$ 0,00')
  assert.strictEqual(formatarMoedaBR(8.5), 'R$ 8,50')
})

caso('TESTE 12 — mes aceita objeto { ano, mes }', () => {
  const { total } = calcularTotalCondominio({
    itens: [item('1002', 'Cota Condominial', 840.82, '2026-04-01', null)],
    mes: { ano: 2026, mes: 9 },
    gas: 0,
    agua: 0,
  })
  assert.strictEqual(total, 840.82)
})

console.log('')
console.log(`${passou} ok, ${falhou} falharam`)
if (falhou > 0) process.exit(1)
