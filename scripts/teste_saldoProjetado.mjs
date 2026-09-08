import assert from 'node:assert/strict'
import {
  calcularSaldoProjetado,
  adicionarDiasISO,
  saldoAteData,
  calcularSaldoReal,
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

function movDict(data, valor, tipoOp) {
  return { data, valor, tipo_op: tipoOp }
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

// --- calcularSaldoReal (saldo REAL de um dia passado) -------------------------
verificar('T1 — reverte saída ocorrida depois do alvo (pagamento de hoje não retroage)', () => {
  // Saldo hoje é 900 porque saíram 100 hoje. Ao fim de 06/09 ainda existiam 1000.
  const movs = [movDict('2026-09-08', 100, 'Saida')]
  const r = calcularSaldoReal({
    saldoAtual: 900,
    movimentacoes: movs,
    dataAlvo: '2026-09-06',
    coberturaMinima: '2026-08-01',
  })
  assert.equal(r, 1000)
})

verificar('T2 — reverte entrada ocorrida depois do alvo', () => {
  const movs = [movDict('2026-09-07', 50, 'Entrada')]
  const r = calcularSaldoReal({
    saldoAtual: 1050,
    movimentacoes: movs,
    dataAlvo: '2026-09-06',
    coberturaMinima: '2026-08-01',
  })
  assert.equal(r, 1000)
})

verificar('T3 — movimentação no PRÓPRIO dia alvo não é revertida (fim do dia)', () => {
  const movs = [
    movDict('2026-09-06', 30, 'Entrada'), // ocorreu no fim do dia alvo → permanece
    movDict('2026-09-08', 100, 'Saida'),
  ]
  const r = calcularSaldoReal({
    saldoAtual: 1000,
    movimentacoes: movs,
    dataAlvo: '2026-09-06',
    coberturaMinima: '2026-08-01',
  })
  assert.equal(r, 1100) // ao fim de 06/09 ainda sem a saída de 08 (revertida)
})

verificar('T4 — sem movimentações depois do alvo o saldo é o atual', () => {
  const movs = [
    movDict('2026-09-04', 20, 'Entrada'),
    movDict('2026-09-05', 10, 'Saida'),
  ]
  const r = calcularSaldoReal({
    saldoAtual: 500,
    movimentacoes: movs,
    dataAlvo: '2026-09-06',
    coberturaMinima: '2026-08-01',
  })
  assert.equal(r, 500)
})

verificar('T5 — transferência interna após o alvo anula (efeito líquido zero)', () => {
  const movs = [
    movDict('2026-09-07', 100, 'Saida'),
    movDict('2026-09-07', 100, 'Entrada'),
  ]
  const r = calcularSaldoReal({
    saldoAtual: 1000,
    movimentacoes: movs,
    dataAlvo: '2026-09-06',
    coberturaMinima: '2026-08-01',
  })
  assert.equal(r, 1000)
})

verificar('T6 — alvo anterior à cobertura devolve null (mostra "—")', () => {
  const r = calcularSaldoReal({
    saldoAtual: 1000,
    movimentacoes: [],
    dataAlvo: '2026-07-15',
    coberturaMinima: '2026-08-01',
  })
  assert.equal(r, null)
})

verificar('T7 — centavos preservados sem deriva de ponto flutuante', () => {
  const movs = [movDict('2026-09-07', 0.05, 'Entrada')]
  const r = calcularSaldoReal({
    saldoAtual: 10.05,
    movimentacoes: movs,
    dataAlvo: '2026-09-06',
    coberturaMinima: '2026-08-01',
  })
  assert.equal(r, 10.0)
})

verificar('T8 — base do período usa a VÉSPERA (não o dia 1º): reais do dia 1º ficam para o resumo', () => {
  // Semana atual começa 07/09. A base do saldo deve ser ao fim de 06/09:
  // um lançamento REAL de 07/09 (que vira item realizado no resumo da janela)
  // não pode estar na base — senão contaria 2x.
  const movs = [movDict('2026-09-07', 121.04, 'Saida')]
  const baseVespera = calcularSaldoReal({
    saldoAtual: 1000,
    movimentacoes: movs,
    dataAlvo: '2026-09-06',
    coberturaMinima: '2026-08-01',
  })
  assert.equal(baseVespera, 1121.04) // a saída de 07/09 foi revertida (fora da base)
  // resultado da janela (S37) Entradas 2050 − Saídas 1463,59 → 586,41
  const saldoFimPeriodo = Math.round((baseVespera + 586.41) * 100) / 100
  assert.equal(saldoFimPeriodo, 1707.45) // 1121,04 + 586,41 (sem duplicar a saída de 07/09)
})

verificar('T9 — projeção em CADEIA: saldo fim da semana N = fim da anterior + resultado da atual', () => {
  // Base real na véspera da semana corrente (06/09) + lançamentos da série.
  const base = 1649.6
  const itens = [
    item('e37', '2026-09-07', 2050, 'Entrada'), // previsto S37
    item('s37', '2026-09-10', 1463.59, 'Saida'), // previsto S37
    item('s38', '2026-09-15', 700, 'Saida'), // previsto S38
    item('e38', '2026-09-18', 1000, 'Entrada'), // previsto S38
  ]
  const r = calcularSaldoProjetado(base, itens, { inicioISO: '2026-09-07', fimISO: '2026-09-20' })
  // Fim da S37 (13/09) = base + R37 (2050 − 1463,59 = 586,41) → 2236,01
  const fimSemanaAtual = Math.round(saldoAteData(r.serie, '2026-09-13', base) * 100) / 100
  assert.equal(fimSemanaAtual, 2236.01)
  // Fim da S38 (20/09) = fim da S37 + R38 (1000 − 700 = 300) → 2536,01
  const fimProximaSemana = Math.round(saldoAteData(r.serie, '2026-09-20', base) * 100) / 100
  assert.equal(fimProximaSemana, 2536.01)
  // Saldo ao fim da faixa (mesma régua).
  assert.equal(r.saldoAoFim, 2536.01)
})

console.log(`\n${ok} passaram, ${falhou} falharam.`)
process.exit(falhou > 0 ? 1 : 0)