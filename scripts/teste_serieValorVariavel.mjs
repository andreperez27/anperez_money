import assert from 'node:assert/strict'
import {
  identificarRegraValorVariavel,
  extrairHistoricosVariaveis,
  calcularReprojecaoValorVariavel,
  montarObservacaoEnergia,
  ehConsumoRealInformado,
  montarObservacaoCondominioReal,
  MARCADOR_CONSUMO_REAL,
} from '../src/lib/serieValorVariavel.js'
import { montarObservacaoCondominio } from '../src/lib/despesaRecorrenteCalc.js'

// ============================================================================
// Testes da ATUALIZAÇÃO AUTOMÁTICA de séries de valor variável (09/09/2026).
// Rodar: node scripts/teste_serieValorVariavel.mjs
//
// Cobrem: identificação das séries por média (Condomínio/Energia), extração
// dos históricos de Gás/Água das observações e a reprojeção que recalcula SÓ
// as ocorrências 'previsto' (passado realizado/cancelado imutável).
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

function item(cod, descricao, valor, inicio, termino = null) {
  return { cod, descricao, valor, vigencia_inicio: inicio, vigencia_termino: termino, categoria: '' }
}

function linha(id, extras) {
  return {
    id,
    tipo_op: 'Saida',
    descricao: 'Condomínio',
    valor: 0,
    data_prevista: '2026-11-10',
    estado: 'previsto',
    serie_id: 'serie-1',
    parcela_numero: 1,
    total_parcelas: 3,
    origem: 'recorrente',
    observacao: '',
    ...extras,
  }
}

// --- Identificação ------------------------------------------------------------

caso('condomínio reconhecido pela descrição (prefixo sem acento incluso)', () => {
  assert.strictEqual(identificarRegraValorVariavel(linha('a', { descricao: 'Condomínio' })), 'condominio')
  assert.strictEqual(identificarRegraValorVariavel(linha('b', { descricao: 'Condominio' })), 'condominio')
})

caso('energia reconhecida pelo marcador da observação', () => {
  const obs = montarObservacaoEnergia({ reais: [154.9, 188.72, 160.59], projecao: 168.07 })
  assert.strictEqual(identificarRegraValorVariavel(linha('c', { descricao: 'Enel', observacao: obs })), 'energia')
})

caso('energia reconhecida pela descrição (Enel) mesmo sem marcador', () => {
  assert.strictEqual(identificarRegraValorVariavel(linha('d', { descricao: 'Enel' })), 'energia')
})

caso('avulsa (sem serie_id) NÃO entra na regra de valor variável', () => {
  assert.strictEqual(identificarRegraValorVariavel({ id: 'e', descricao: 'Condomínio' }), null)
})

caso('série fixa comum (ex.: DAS-MEI, Vivo) NÃO entra', () => {
  assert.strictEqual(identificarRegraValorVariavel(linha('f', { descricao: 'DAS-MEI' })), null)
})

// --- Extração dos históricos reais --------------------------------------------

caso('extração: dedupe por mês, ordem cronológica, só 1010/1052', () => {
  const realizados = [
    { data_prevista: '2026-11-10', observacao: '1002 Cota R$ 1,00\n1010 Consumo de Gás R$ 130,00\n1052 Consumo de Água R$ 162,00' },
    { data_prevista: '2026-10-10', observacao: '1010 Consumo de Gás R$ 124,15\n1052 Consumo de Água R$ 158,30' },
    // mesma época que outubro → descartado pelo dedupe de mês
    { data_prevista: '2026-10-15', observacao: '1010 Consumo de Gás R$ 999,99' },
  ]
  const { gas, agua } = extrairHistoricosVariaveis(realizados)
  assert.deepStrictEqual(gas, [124.15, 130])
  assert.deepStrictEqual(agua, [158.3, 162])
})

caso('extração: não quebra com observação ausente/data vazia', () => {
  const { gas, agua } = extrairHistoricosVariaveis([
    { data_prevista: '2026-10-10', observacao: null },
    { data_prevista: null, observacao: '1010 Consumo de Gás R$ 5,00' },
  ])
  assert.deepStrictEqual(gas, [])
  assert.deepStrictEqual(agua, [])
})

// --- Reprojeção de ENERGIA ----------------------------------------------------

caso('energia: reprojeta TODOS os previstos com a nova média', () => {
  const linhas = [
    linha('r1', { estado: 'realizado', valor: 150 }),
    linha('p1', { data_prevista: '2026-11-09', valor: 200, observacao: 'antiga' }),
    linha('p2', { data_prevista: '2026-12-09', valor: 200, observacao: 'antiga' }),
  ]
  const { updates } = calcularReprojecaoValorVariavel({
    linhas,
    tipo: 'energia',
    historicoValor: [150, 180, 160],
  })
  assert.strictEqual(updates.length, 2)
  for (const u of updates) {
    assert.strictEqual(u.valor, 163.33) // (150+180+160)/3
    assert.ok(u.observacao.includes('150.00 · 180.00 · 160.00 = 163.33'))
    assert.ok(u.observacao.includes('projeção pela regra de valor variável'))
  }
  assert.ok(!updates.some((u) => u.id === 'r1'), 'realizado nunca é tocado')
})

caso('energia: média desliza ao entrar um real novo (recém-realizado)', () => {
  const linhas = [
    linha('r1', { estado: 'realizado', valor: 150 }),
    linha('r2', { estado: 'realizado', valor: 180 }),
    linha('r3', { estado: 'realizado', valor: 160 }),
    linha('r4', { estado: 'realizado', valor: 200 }), // set/26 recém-lançado
    linha('p1', { data_prevista: '2026-11-09', valor: 999 }),
  ]
  const { updates } = calcularReprojecaoValorVariavel({
    linhas,
    tipo: 'energia',
    historicoValor: [180, 160, 200], // últimos 3 = 180 · 160 · 200 → 180
  })
  assert.strictEqual(updates.length, 1)
  assert.strictEqual(updates[0].valor, 180)
})

caso('energia: sem nenhum real histórico mantém a projeção gravada', () => {
  const linhas = [linha('p1', { data_prevista: '2026-11-09', valor: 168.07 })]
  const { updates } = calcularReprojecaoValorVariavel({ linhas, tipo: 'energia', historicoValor: [] })
  assert.strictEqual(updates.length, 0)
})

caso('energia: idempotente — valor/observação iguais não re-gravam', () => {
  const obs = montarObservacaoEnergia({ reais: [150, 180, 160], projecao: 163.33 })
  const linhas = [linha('p1', { data_prevista: '2026-11-09', valor: 163.33, observacao: obs })]
  const { updates } = calcularReprojecaoValorVariavel({
    linhas,
    tipo: 'energia',
    historicoValor: [150, 180, 160],
  })
  assert.strictEqual(updates.length, 0)
})

// --- Reprojeção de CONDOMÍNIO ---------------------------------------------------

caso('condomínio: recalcula só os previstos (fixos vigentes + Gás/Água médios)', () => {
  const itensFixos = [item('1002', 'Cota Condominial', 840.82, '2026-04-01', null)]
  const linhas = [
    linha('r1', { estado: 'realizado', valor: 1463.59, observacao: 'real de out' }),
    linha('p1', { data_prevista: '2026-11-10', valor: 1463.59, observacao: 'antiga' }),
    linha('p2', { data_prevista: '2026-12-10', valor: 1463.59, observacao: 'antiga' }),
  ]
  const { updates } = calcularReprojecaoValorVariavel({
    linhas,
    tipo: 'condominio',
    itensFixos,
    historicoGas: [120.05, 124.08, 128.33], // média → 124.15
    historicoAgua: [155.2, 158.71, 160.99], // média → 158.30
  })
  assert.strictEqual(updates.length, 2)
  const esperado = Math.round((840.82 + 124.15 + 158.3) * 100) / 100 // 1123.27
  for (const u of updates) {
    assert.strictEqual(u.valor, esperado)
    assert.ok(u.observacao.includes('1010 Consumo de Gás R$ 124,15'))
    assert.ok(u.observacao.includes('1052 Consumo de Água R$ 158,30'))
  }
})

caso('condomínio: menos de 3 reais repete o último real', () => {
  const itensFixos = []
  const linhas = [linha('p1', { data_prevista: '2026-11-10', valor: 999 })]
  const { updates } = calcularReprojecaoValorVariavel({
    linhas,
    tipo: 'condominio',
    historicoGas: [100, 110],
    historicoAgua: [40],
  })
  assert.strictEqual(updates[0].valor, 150) // gás→110 (último), água→40 (último)
})

caso('condomínio: sem histórico projeta só os fixos (variáveis em 0)', () => {
  const itensFixos = [item('1002', 'Cota Condominial', 840.82, '2026-04-01', null)]
  const linhas = [linha('p1', { data_prevista: '2026-11-10', valor: 999 })]
  const { updates } = calcularReprojecaoValorVariavel({
    linhas,
    tipo: 'condominio',
    itensFixos,
    historicoGas: [],
    historicoAgua: [],
  })
  assert.strictEqual(updates[0].valor, 840.82)
  assert.ok(updates[0].observacao.includes('1010 Consumo de Gás R$ 0,00'))
})

caso('condomínio: canceladas e realizadas nunca entram nos updates', () => {
  const itensFixos = []
  const linhas = [
    linha('r1', { estado: 'realizado', valor: 999 }),
    linha('c1', { estado: 'cancelado', valor: 999 }),
    linha('p1', { data_prevista: '2026-11-10', valor: 999 }),
  ]
  const { updates } = calcularReprojecaoValorVariavel({ linhas, tipo: 'condominio' })
  assert.deepStrictEqual(updates.map((u) => u.id), ['p1'])
})

// --- Observação de energia ------------------------------------------------------

caso('montarObservacaoEnergia gera o texto legível com a média atual', () => {
  const obs = montarObservacaoEnergia({ reais: [154.9, 188.72, 160.59], projecao: 168.07 })
  assert.ok(obs.includes('projeção pela regra de valor variável'))
  assert.ok(obs.includes('154.90 · 188.72 · 160.59 = 168.07'))
})

caso('montarObservacaoEnergia com menos de 3 reais diz que repete o último', () => {
  const obs = montarObservacaoEnergia({ reais: [168.07], projecao: 168.07 })
  assert.ok(obs.includes('1 real disponível(is): 168.07 = 168.07 (regra: repete o último real)'))
})

// --- Marcador de consumo real informado (ADENDO PARTE 2 — 13/09/2026) ---------

caso('ehConsumoRealInformado reconhece a linha marcadora 1055', () => {
  const obs = '1002 Cota R$ 840,82\n1010 Consumo de Gás R$ 124,15\n1052 Consumo de Água R$ 158,30\n' + MARCADOR_CONSUMO_REAL
  assert.strictEqual(ehConsumoRealInformado({ observacao: obs }), true)
  assert.strictEqual(ehConsumoRealInformado({ observacao: '1002 Cota R$ 840,82\n1010 Consumo de Gás R$ 124,15' }), false)
  assert.strictEqual(ehConsumoRealInformado({ observacao: null }), false)
  assert.strictEqual(ehConsumoRealInformado({}), false)
})

caso('montarObservacaoCondominioReal gera o detalhamento + o marcador no fim', () => {
  const obs = montarObservacaoCondominioReal([
    { cod: '1002', descricao: 'Cota Condominial', valor: 840.82, referencia: '', categoria: '' },
    { cod: '1010', descricao: 'Consumo de Gás', valor: 124.15, referencia: '', categoria: '' },
  ])
  assert.ok(obs.startsWith('1002 Cota Condominial R$ 840,82'))
  assert.ok(obs.includes('1010 Consumo de Gás R$ 124,15'))
  assert.ok(obs.endsWith('\n' + MARCADOR_CONSUMO_REAL))
})

caso('condomínio: mês marcado por consumo real fica IMUNE à reprojeção', () => {
  const itensFixos = [item('1002', 'Cota Condominial', 840.82, '2026-04-01', null)]
  const obsReal = montarObservacaoCondominio([
    { cod: '1002', descricao: 'Cota Condominial', valor: 840.82, referencia: '', categoria: '' },
    { cod: '1010', descricao: 'Consumo de Gás', valor: 125.0, referencia: '', categoria: '' },
    { cod: '1052', descricao: 'Consumo de Água', valor: 160.0, referencia: '', categoria: '' },
  ]) + '\n' + MARCADOR_CONSUMO_REAL
  const linhas = [
    // Mês corrigido por consumo real: valor/observação travados.
    linha('p1', { data_prevista: '2026-11-10', valor: 1125.82, observacao: obsReal }),
    // Outro mês ainda por média: deve ser recalculado.
    linha('p2', { data_prevista: '2026-12-10', valor: 1463.59, observacao: 'antiga' }),
  ]
  const { updates } = calcularReprojecaoValorVariavel({
    linhas,
    tipo: 'condominio',
    itensFixos,
    historicoGas: [124.15, 128.33, 130.0], // média → 127.49
    historicoAgua: [158.3, 160.99, 162.0], // média → 160.43
  })
  assert.deepStrictEqual(updates.map((u) => u.id), ['p2'], 'o mês marcado não entra nos updates')
  const esperado = Math.round((840.82 + 127.49 + 160.43) * 100) / 100
  assert.strictEqual(updates[0].valor, esperado)
  assert.ok(!updates[0].observacao.includes('1055'))
})

caso('condomínio: imune também quando o valor informado difere da média', () => {
  const obsReal = montarObservacaoCondominioReal([
    { cod: '1010', descricao: 'Consumo de Gás', valor: 90.0, referencia: '', categoria: '' },
    { cod: '1052', descricao: 'Consumo de Água', valor: 52.0, referencia: '', categoria: '' },
  ])
  const linhas = [linha('p1', { data_prevista: '2026-11-10', valor: 142.0, observacao: obsReal })]
  const { updates } = calcularReprojecaoValorVariavel({
    linhas,
    tipo: 'condominio',
    historicoGas: [200, 210, 220],
    historicoAgua: [150, 160, 170],
  })
  assert.deepStrictEqual(updates, [], 'valor real travado nunca é sobrescrito pela média')
})

console.log(`\n${ok} testes passaram, ${falhou} falharam.`)
if (falhou > 0) process.exit(1)