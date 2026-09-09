import assert from 'node:assert/strict'
import { projetarOcorrenciasCondominio } from '../src/lib/despesaRecorrenteCalc.js'
import { semanaIso } from '../src/lib/semana.js'

// ============================================================================
// Testes da PROJEÇÃO DA SÉRIE MENSAL DE CONDOMÍNIO (Passo 3/4 — 08/09/2026).
// Rodar: node scripts/teste_serieCondominio.mjs
//
// Cobrem a regra definitiva de valor variável aplicada à geração da série:
// média dos 3 últimos reais (com fallback p/ o último real quando há menos de
// 3) e o horizonte cobrindo 90 dias — incluindo o CASO REAL da semana 41:
// vencimento 10/10/2026 (Condomínio deixou de aparecer na projeção).
// ============================================================================

let ok = 0
let falhou = 0

function caso(nome, fn) {
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

// Fábrica de item fixo (mesmo shape de despesa_recorrente_item).
function item(cod, descricao, valor, inicio, termino = null) {
  return { cod, descricao, valor, vigencia_inicio: inicio, vigencia_termino: termino, categoria: '' }
}

// Itens fixos VIGENTES no cenário real (mesmos do teste_despesaRecorrenteCalc
// e lançados por lancar_condominio_mes.py).
const ITENS_REAIS = [
  item('1002', 'Cota Condominial', 840.82, '2026-04-01', null),
  item('1050', 'Taxa de Coleta', 70.76, '2026-06-01', null),
  item('15002', 'Manut. Pintura PC', 170, '2026-01-01', '2027-12-31'),
  item('3002', 'Fundo de Reserva', 42.04, '2026-04-01', null),
  item('1102', 'Leitura de Água e Gás', 8.48, '2024-01-01', null),
  item('2002', 'Benfeitorias', 46, '2024-01-01', '2026-12-31'),
]

const FIXOS_OUT_2026 = 840.82 + 70.76 + 170 + 42.04 + 8.48 + 46 // 1178.10
// 3 reais de Gás e Água (média: 124.15 e 158.30)
const GAS_REAIS = [120.05, 124.08, 128.33]
const AGUA_REAIS = [155.2, 158.71, 160.99]
const GAS_PROJ = 124.15
const AGUA_PROJ = 158.3

// --- CASO REAL: série a partir de OUT/2026, vencimento dia 10 -----------------

caso('CASO REAL — série cobre o horizonte (24 meses) e nasce em 10/10/2026', () => {
  const ocorrencias = projetarOcorrenciasCondominio({
    itens: ITENS_REAIS,
    historicoGas: GAS_REAIS,
    historicoAgua: AGUA_REAIS,
    mesInicio: '2026-10',
    diaVencimento: 10,
    totalMeses: 24,
  })
  assert.strictEqual(ocorrencias.length, 24)
  assert.strictEqual(ocorrencias[0].mes, '2026-10')
  assert.strictEqual(ocorrencias[0].dataPrevista, '2026-10-10')

  const primeira = new Date(ocorrencias[0].dataPrevista)
  const ultima = new Date(ocorrencias[ocorrencias.length - 1].dataPrevista)
  const diasCobertos = (ultima - primeira) / 86400000
  assert.ok(diasCobertos >= 90, `horizonte de ${diasCobertos} dias — deveria cobrir 90`)
})

caso('CASO REAL — 10/10/2026 cai na SEMANA 41 de 2026 (projeção da tela)', () => {
  const { ano, semana } = semanaIso('2026-10-10')
  assert.strictEqual(ano, 2026)
  assert.strictEqual(semana, 41)
})

caso('CASO REAL — valor de OUT/2026 = fixos vigentes + média dos 3 últimos reais', () => {
  const ocorrencias = projetarOcorrenciasCondominio({
    itens: ITENS_REAIS,
    historicoGas: GAS_REAIS,
    historicoAgua: AGUA_REAIS,
    mesInicio: '2026-10',
    diaVencimento: 10,
    totalMeses: 24,
  })
  const out = ocorrencias[0]
  const esperado = Math.round((FIXOS_OUT_2026 + GAS_PROJ + AGUA_PROJ) * 100) / 100
  assert.strictEqual(out.valor, esperado)
  const gas = out.detalhamento.find((l) => l.cod === '1010')
  const agua = out.detalhamento.find((l) => l.cod === '1052')
  assert.strictEqual(gas.valor, GAS_PROJ)
  assert.strictEqual(agua.valor, AGUA_PROJ)
})

// --- Regra de valor variável --------------------------------------------------

caso('3+ reais → média dos 3 últimos (todas as ocorrências da série)', () => {
  const ocorrencias = projetarOcorrenciasCondominio({
    itens: [],
    historicoGas: [100, 110, 120],
    historicoAgua: [10, 20, 30],
    mesInicio: '2026-10',
    diaVencimento: 10,
    totalMeses: 3,
  })
  const esperado = 110 + 20
  for (const o of ocorrencias) {
    assert.strictEqual(o.valor, esperado)
  }
})

caso('menos de 3 reais → repete a ÚLTIMA ocorrência (sem média)', () => {
  const ocorrencias = projetarOcorrenciasCondominio({
    itens: [],
    historicoGas: [100, 110],
    historicoAgua: [40],
    mesInicio: '2026-10',
    diaVencimento: 10,
    totalMeses: 2,
  })
  // Gás: 2 reais → último (110); Água: 1 real → último (40).
  assert.strictEqual(ocorrencias[0].valor, 150)
  assert.strictEqual(ocorrencias[1].valor, 150)
})

caso('sem histórico → projeta só os fixos (variáveis em 0)', () => {
  const ocorrencias = projetarOcorrenciasCondominio({
    itens: [item('1002', 'Cota Condominial', 840.82, '2026-04-01', null)],
    historicoGas: [],
    historicoAgua: [],
    mesInicio: '2026-10',
    diaVencimento: 10,
    totalMeses: 1,
  })
  assert.strictEqual(ocorrencias[0].valor, 840.82)
  const gas = ocorrencias[0].detalhamento.find((l) => l.cod === '1010')
  assert.strictEqual(gas.valor, 0)
})

// --- Fixos: vigência e referência série por mês --------------------------------

caso('referências da série evoluem por mês (34/36 em OUT/26, 35/36 em NOV/26)', () => {
  const ocorrencias = projetarOcorrenciasCondominio({
    itens: [item('2002', 'Benfeitorias', 46, '2024-01-01', '2026-12-31')],
    historicoGas: [],
    historicoAgua: [],
    mesInicio: '2026-10',
    diaVencimento: 10,
    totalMeses: 2,
  })
  const benf60 = ocorrencias[0].detalhamento.find((l) => l.cod === '2002')
  const benfNov = ocorrencias[1].detalhamento.find((l) => l.cod === '2002')
  assert.strictEqual(benf60.referencia, '34/36')
  assert.strictEqual(benfNov.referencia, '35/36')
})

caso('item com fim sai da série ao encerrar a vigência (Benfeitorias em 2027)', () => {
  const ocorrencias = projetarOcorrenciasCondominio({
    itens: [item('2002', 'Benfeitorias', 46, '2024-01-01', '2026-12-31')],
    historicoGas: [],
    historicoAgua: [],
    mesInicio: '2027-01',
    diaVencimento: 10,
    totalMeses: 1,
  })
  assert.ok(!ocorrencias[0].detalhamento.some((l) => l.cod === '2002'))
  assert.strictEqual(ocorrencias[0].valor, 0)
})

caso('Manut. Pintura PC 13/24 em JAN/2027', () => {
  const ocorrencias = projetarOcorrenciasCondominio({
    itens: [item('15002', 'Manut. Pintura PC', 170, '2026-01-01', '2027-12-31')],
    historicoGas: [],
    historicoAgua: [],
    mesInicio: '2027-01',
    diaVencimento: 10,
    totalMeses: 1,
  })
  const m = ocorrencias[0].detalhamento.find((l) => l.cod === '15002')
  assert.strictEqual(m.referencia, '13/24')
})

// --- Datas ----------------------------------------------------------------------

caso('vencimento clampado no fim do mês (dia 31 em fev e meses de 30)', () => {
  const ocorrencias = projetarOcorrenciasCondominio({
    itens: [],
    historicoGas: [],
    historicoAgua: [],
    mesInicio: '2026-02',
    diaVencimento: 31,
    totalMeses: 2,
  })
  assert.strictEqual(ocorrencias[0].dataPrevista, '2026-02-28')
  assert.strictEqual(ocorrencias[1].dataPrevista, '2026-03-31')
})

// --- Observação e validação ------------------------------------------------------

caso('observação de OUT/26 tem fixo com ref + gás + água', () => {
  const ocorrencias = projetarOcorrenciasCondominio({
    itens: ITENS_REAIS,
    historicoGas: GAS_REAIS,
    historicoAgua: AGUA_REAIS,
    mesInicio: '2026-10',
    diaVencimento: 10,
    totalMeses: 1,
  })
  const linhas = ocorrencias[0].observacao.split('\n')
  assert.ok(linhas.some((l) => l === '2002 Benfeitorias 34/36 R$ 46,00'))
  assert.ok(linhas.some((l) => l === `1010 Consumo de Gás ${'R$ 124,15'}`))
  assert.ok(linhas.some((l) => l === `1052 Consumo de Água ${'R$ 158,30'}`))
})

caso('mesInicio inválido lança erro claro', () => {
  assert.throws(
    () => projetarOcorrenciasCondominio({ itens: [], mesInicio: '10/2026' }),
    (e) => e instanceof Error && e.message.includes('mesInicio'),
  )
})

console.log(`\n${ok} testes passaram, ${falhou} falharam.`)
if (falhou > 0) process.exit(1)