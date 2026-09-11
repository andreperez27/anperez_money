import assert from 'node:assert/strict'
import {
  calcularSaldoProjetado,
  adicionarDiasISO,
  saldoAteData,
  calcularSaldoReal,
  projetarSerie,
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

// --- projetarSerie (projeção a partir do saldo REAL de hoje — Bug 1, 11/09/2026)
verificar('T8 — meio da semana: projeção parte do saldo REAL de hoje (sem inflar) e só soma o futuro', () => {
  // Bug 1 real: hoje = 11/09 (sexta, semana 37). Saldo real = 1.039,17. A antiga
  // série partia da véspera (1.649,60) e reverteria as avulsas do início da
  // semana (Padaria, Enel, pagamento de fatura...) que NÃO têm item de
  // planejamento — resultado: projetado 2.236,01 (inflado em 1.196,84).
  const saldoAtual = 1039.17
  const itensSomatorio = [
    item('r9', '2026-09-09', 2050, 'Entrada'), // Pagamento Semanal — ja realizado, no saldo real
    item('r10', '2026-09-10', 1463.59, 'Saida'), // Condomínio — ja realizado, no saldo real
    item('p16', '2026-09-16', 2175, 'Entrada'), // Pagamento Semanal previsto
    item('p20a', '2026-09-20', 900, 'Saida'), // previsto
    item('p20b', '2026-09-20', 86.05, 'Saida'), // previsto
    item('p9', '2026-09-09', 999, 'Entrada'), // da véspera — reapareceria se reanimássemos; fora do futuro
  ]
  const r = projetarSerie({
    saldoAtual,
    itens: itensSomatorio,
    inicioISO: '2026-09-11', // hoje
    fimISO: '2026-09-20',
  })

  // A série NÃO começa em 2.236,01 inflado: para o fim da semana corrente
  // (13/09) o saldo projetado é o saldo real de hoje (sem avulsas fantasma).
  const fimSemanaCorrente = saldoAteData(r.serie, '2026-09-13', saldoAtual)
  assert.ok(Math.abs(fimSemanaCorrente - 1039.17) < 0.001, `fim S37 deveria ser 1039,17, veio ${fimSemanaCorrente}`)
  // Só entram na série os previstos com data_prevista ESTRITAMENTE > hoje.
  assert.deepEqual(
    r.serie.map((m) => m.data),
    ['2026-09-16', '2026-09-20'],
  )
  // Encadeamento conservado: fim S38 = fim S37 + resultado previsto da S38.
  const resultadoS38 = 2175 - 900 - 86.05
  const fimProximaSemana = saldoAteData(r.serie, '2026-09-20', saldoAtual)
  assert.ok(Math.abs(fimProximaSemana - (fimSemanaCorrente + resultadoS38)) < 0.001)
  assert.ok(Math.abs(fimProximaSemana - 2228.12) < 0.001)
})

verificar('T9 — meio da semana: realizado da própria semana NÃO conta de novo (já está no saldo real)', () => {
  // O mesmo item realizado em 09/09 (Pagamento Semanal) já está embutido no
  // saldo real de hoje (1.039,17). Se a série o somasse de novo, o saldo
  // projetado dobraria o recebimento. Com a base em "hoje", isso está resolvido.
  const saldoAtual = 1039.17
  const r = projetarSerie({
    saldoAtual,
    itens: [item('r9', '2026-09-09', 2050, 'Entrada')], // realizado antes de hoje
    inicioISO: '2026-09-11',
    fimISO: '2026-09-20',
  })
  assert.deepEqual(r.serie, []) // nada futuro → série vazia
  assert.ok(Math.abs(saldoAteData(r.serie, '2026-09-20', saldoAtual) - 1039.17) < 0.001)
})

verificar('T10 — início da semana (hoje = 07/09): previstos da própria semana ainda contam', () => {
  // Rodando no INÍCIO da semana (segunda 07/09), nada da semana aconteceu: o
  // saldo real ainda é o da véspera (1.649,60) e os previstos de 09/09 e 10/09
  // entram na projeção normalmente.
  const saldoAtual = 1649.6
  const itens = [
    item('p9', '2026-09-09', 2050, 'Entrada'),
    item('p10', '2026-09-10', 1463.59, 'Saida'),
  ]
  const r = projetarSerie({ saldoAtual, itens, inicioISO: '2026-09-07', fimISO: '2026-09-13' })
  const fimSemana = saldoAteData(r.serie, '2026-09-13', saldoAtual)
  // 1.649,60 + 2050 − 1463,59 = 2.236,01 (o mesmo valor "antigo" — que era
  // correto quando rodado no início da semana, e só virava inflação no meio).
  assert.ok(Math.abs(fimSemana - 2236.01) < 0.001)
})

verificar('T11 — encadeamento em cadeia: saldo fim S_{n+1} = saldo fim S_n + resultado previsto da próxima', () => {
  // Meio da semana (hoje = 11/09), saldo real 1.039,17. Três semanas previstas:
  // S37 (nada após hoje), S38 (16/09 +2.175, 20/09 −900 −86,05) e S39 (23/09 +2.050).
  const saldoAtual = 1039.17
  const itens = [
    item('p16', '2026-09-16', 2175, 'Entrada'),
    item('p20a', '2026-09-20', 900, 'Saida'),
    item('p20b', '2026-09-20', 86.05, 'Saida'),
    item('p23', '2026-09-23', 2050, 'Entrada'),
  ]
  const r = projetarSerie({ saldoAtual, itens, inicioISO: '2026-09-11', fimISO: '2026-09-27' })

  const fimS37 = saldoAteData(r.serie, '2026-09-13', saldoAtual) // 1039,17
  const fimS38 = saldoAteData(r.serie, '2026-09-20', saldoAtual) // fimS37 + 1188,95
  const fimS39 = saldoAteData(r.serie, '2026-09-27', saldoAtual) // fimS38 + 2050

  assert.ok(Math.abs(fimS37 - 1039.17) < 0.001)
  assert.ok(Math.abs(fimS38 - (fimS37 + (2175 - 900 - 86.05))) < 0.001)
  assert.ok(Math.abs(fimS38 - 2228.12) < 0.001)
  assert.ok(Math.abs(fimS39 - (fimS38 + 2050)) < 0.001)
  assert.ok(Math.abs(fimS39 - 4278.12) < 0.001)
})

console.log(`\n${ok} passaram, ${falhou} falharam.`)
process.exit(falhou > 0 ? 1 : 0)