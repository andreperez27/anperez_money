import assert from 'node:assert/strict'
import {
  calcularSaldoProjetado,
  adicionarDiasISO,
  saldoAteData,
} from '../src/lib/saldoProjetado.js'
import { montarProjecao, montarItensFerias } from '../src/lib/faturaProjecao.js'
import { calcularResumoPlanejamentos } from '../src/lib/planejamentoCalc.js'

// ============================================================================
// Testes do SALDO ACUMULADO PROJETADO + marcadores de FÉRIAS (libs puras).
// Rodar: node scripts/teste_saldoProjetado.mjs
// ============================================================================

let ok = 0
let falhou = 0

function verificar(nome, fn) {
  try {
    fn()
    ok++
    console.log(`ok      — ${nome}`)
  } catch (e) {
    falhou++
    console.error(`FALHOU  — ${nome}\n         ${e.message}`)
  }
}

function item(id, data, valor, tipoOp, extra = {}) {
  return { id, estado: 'previsto', data_prevista: data, valor, tipo_op: tipoOp, ...extra }
}

// --- adicionarDiasISO ---------------------------------------------------------
verificar('S1 — adicionarDiasISO soma dias cruzando mês/ano', () => {
  assert.equal(adicionarDiasISO('2026-08-31', 1), '2026-09-01')
  assert.equal(adicionarDiasISO('2026-12-30', 2), '2027-01-01')
  assert.equal(adicionarDiasISO('2026-03-15', 0), '2026-03-15')
})

// --- saldoAteData ---------------------------------------------------------------
verificar('S2 — saldoAteData devolve saldoInicial antes de qualquer movimento', () => {
  const serie = [{ data: '2026-09-10', saldo: 500 }]
  assert.equal(saldoAteData(serie, '2026-09-05', 1000), 1000)
  assert.equal(saldoAteData(serie, '2026-09-10', 1000), 500)
  assert.equal(saldoAteData(serie, '2026-09-20', 1000), 500)
})

// --- calcularSaldoProjetado -------------------------------------------------------
verificar('S3 — acumula partindo do saldo inicial (entrada soma, saída subtrai)', () => {
  const itens = [
    item('e1', '2026-09-05', 50, 'Entrada'),
    item('s1', '2026-09-07', 30, 'Saida'),
    item('e2', '2026-09-10', 20, 'Entrada'),
  ]
  const r = calcularSaldoProjetado(1000, itens, { inicioISO: '2026-09-01', fimISO: '2026-09-30' })
  assert.equal(r.saldoAoFim, 1040)
  assert.deepEqual(r.serie.map((m) => m.saldo), [1050, 1020, 1040])
})

verificar('S4 — ignora cancelados no acumulado', () => {
  const itens = [
    item('s1', '2026-09-07', 30, 'Saida'),
    item('s2', '2026-09-08', 999, 'Saida', { estado: 'cancelado' }),
  ]
  const r = calcularSaldoProjetado(100, itens, { inicioISO: '2026-09-01', fimISO: '2026-09-30' })
  assert.equal(r.saldoAoFim, 70)
})

verificar('S5 — itens fora da faixa (passado) não contam no acumulado do horizonte', () => {
  const itens = [item('s1', '2026-01-05', 30, 'Saida'), item('s2', '2026-09-20', 10, 'Saida')]
  const r = calcularSaldoProjetado(100, itens, { inicioISO: '2026-09-01', fimISO: '2026-09-30' })
  assert.equal(r.saldoAoFim, 90)
})

verificar('S6 — item valor 0 (marcador de férias) não move o saldo', () => {
  const itens = [item('f1', '2026-09-15', 0, 'Entrada', { ferias: true })]
  const r = calcularSaldoProjetado(500, itens, { inicioISO: '2026-09-01', fimISO: '2026-09-30' })
  assert.equal(r.saldoAoFim, 500)
})

verificar('S7 — ordena itens fora de ordem cronológica', () => {
  const itens = [
    item('b', '2026-09-10', 20, 'Entrada'),
    item('a', '2026-09-05', 10, 'Saida'),
  ]
  const r = calcularSaldoProjetado(100, itens, { inicioISO: '2026-09-01', fimISO: '2026-09-30' })
  assert.deepEqual(r.serie.map((m) => m.saldo), [90, 110])
})

// --- marcadores de férias (montarItensFerias) ---------------------------------
verificar('S8 — um marcador por intervalo, na data_inicio, ciano, com o intervalo', () => {
  const marcadores = montarItensFerias(
    [
      { id: 'f1', data_inicio: '2026-09-14', data_fim: '2026-09-18' },
      { id: 'f2', data_inicio: '2026-10-05', data_fim: '2026-10-05' },
    ],
    { inicioISO: '2026-09-01', fimISO: '2026-09-30' },
  )
  assert.equal(marcadores.length, 1) // só o que cai no horizonte
  assert.equal(marcadores[0].id, 'ferias:f1')
  assert.equal(marcadores[0].ferias, true)
  assert.equal(marcadores[0].valor, 0)
  assert.equal(marcadores[0].data_prevista, '2026-09-14')
  assert.ok(marcadores[0].descricao.includes('Férias'))
  assert.ok(marcadores[0].descricao.includes('2026-09-14') === false) // usa formatarData (dd/mm/aaaa)
})

verificar('S9 — férias entram só no VISÍVEL (R$ 0) e não alteram o somatório', () => {
  const itensBase = [item('s1', '2026-09-10', 100, 'Saida')]
  const ferias = [{ id: 'f1', data_inicio: '2026-09-15', data_fim: '2026-09-20' }]
  const { itensVisiveis, itensParaSomatorio } = montarProjecao({
    itensBase,
    cartoes: [],
    faturasReais: [],
    inicioISO: '2026-09-01',
    fimISO: '2026-09-30',
    ferias,
  })
  const visiveisId = itensVisiveis.map((i) => i.id)
  assert.ok(visiveisId.includes('ferias:f1'), 'marcador presente no visível')
  assert.ok(!itensParaSomatorio.some((i) => i.id === 'ferias:f1'), 'marcador fora do somatório')
  const r = calcularResumoPlanejamentos(itensParaSomatorio)
  assert.equal(r.totais.saidas, 100)
  assert.equal(r.contagens.previsto, 1) // férias não inflam a contagem de previstos
})

console.log(`\n${ok} passaram, ${falhou} falharam.`)
process.exit(falhou > 0 ? 1 : 0)