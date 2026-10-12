import assert from 'node:assert/strict'
import {
  espelhoControlePonto,
  saldoBancoAte,
} from '../src/lib/controlePontoCalc.js'

// ============================================================================
// Testes do ESPELHO DE CONTROLE DE PONTO (controlePontoCalc.js — lib pura).
// Rodar: node scripts/teste_controlePontoCalc.mjs
// Motor único da aba "Controle de ponto" e do seu PDF. Semana de referência
// 12–18/10/2026 (seg–dom), fixo 1650, tempos padrão (390/330).
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
    console.error(`FALHOU  — ${nome}\n          ${e.message}`)
  }
}

const CONFIG = {
  fixoSemana: 1650,
  temposCarga: { utilEntrada: 1230, utilSaida: 180, sabadoEntrada: 1230, sabadoSaida: 120 },
}
const SEMANA = { inicio: '2026-10-12', fim: '2026-10-18' }
const HOJE = '2026-10-20'

function esp(extra = {}) {
  return espelhoControlePonto({
    ...SEMANA,
    hojeISO: HOJE,
    excecoes: [],
    feriados: [],
    ferias: [],
    config: CONFIG,
    todasExcecoes: [],
    ...extra,
  })
}

caso('dia sem lançamento conta como padrão cumprido (horários da config)', () => {
  const r = esp()
  const seg = r.dias[0]
  assert.equal(seg.situacao, 'padrao')
  assert.equal(seg.entrada, '20:30')
  assert.equal(seg.saida, '03:00')
  assert.equal(seg.horas, 6.5)
  assert.equal(r.resumo.diasTrabalhados, 6) // seg–sáb, sem dom
})

caso('sábado tem carga diferente (5,5h)', () => {
  const r = esp()
  const sab = r.dias.find((d) => d.data === '2026-10-17')
  assert.equal(sab.situacao, 'padrao')
  assert.equal(sab.horas, 5.5)
  assert.equal(sab.saida, '02:00')
})

caso('mês com feriado: dia vira feriado (sem trabalho, sem horas)', () => {
  const r = esp({ feriados: ['2026-10-12'] })
  const seg = r.dias[0]
  assert.equal(seg.situacao, 'feriado')
  assert.equal(seg.horas, null)
  assert.equal(r.resumo.diasTrabalhados, 5)
})

caso('falta de cada destino: situação, minutos e desconto só no pagamento', () => {
  const r = espelhoControlePonto({
    ...SEMANA,
    hojeISO: HOJE,
    excecoes: [
      { data: '2026-10-13', tipo: 'falta', destino: 'pagamento', minutos_falta: 390, valor_desconto: 275 },
      { data: '2026-10-14', tipo: 'falta', destino: 'banco', minutos_falta: 195, valor_desconto: 0 },
      { data: '2026-10-15', tipo: 'falta', destino: 'abonada', minutos_falta: 390, valor_desconto: 0 },
    ],
    feriados: [],
    ferias: [],
    config: CONFIG,
    todasExcecoes: [],
  })
  const porData = new Map(r.dias.map((d) => [d.data, d]))
  assert.equal(porData.get('2026-10-13').situacao, 'falta-pagamento')
  assert.equal(porData.get('2026-10-14').situacao, 'falta-banco')
  assert.equal(porData.get('2026-10-15').situacao, 'falta-abonada')
  assert.equal(porData.get('2026-10-13').descontoFalta, 275)
  assert.equal(porData.get('2026-10-14').descontoFalta, 0)
  assert.deepStrictEqual(r.resumo.faltas.pagamento, { qtd: 1, minutos: 390 })
  assert.deepStrictEqual(r.resumo.faltas.banco, { qtd: 1, minutos: 195 })
  assert.deepStrictEqual(r.resumo.faltas.abonada, { qtd: 1, minutos: 390 })
  // 6 dias de carga − 2 integrais = 4 (parcial de 195 conta).
  assert.equal(r.resumo.diasTrabalhados, 4)
  assert.equal(r.resumo.descFaltas, 275)
})

caso('hora extra no banco: horas contam, valor não; domfer no banco idem', () => {
  const r = espelhoControlePonto({
    ...SEMANA,
    hojeISO: HOJE,
    excecoes: [
      { data: '2026-10-13', tipo: 'he', entrada: '20:30', saída: '05:00', horas: 8.5, he: 2, valor_he: 0, destino: 'banco' },
      { data: '2026-10-18', tipo: 'domfer', entrada: '20:30', saída: '02:00', horas: 5.5, valor_domfer: 0, destino: 'banco' },
    ],
    feriados: [],
    ferias: [],
    config: CONFIG,
    todasExcecoes: [],
  })
  const porData = new Map(r.dias.map((d) => [d.data, d]))
  assert.equal(porData.get('2026-10-13').situacao, 'he-banco')
  assert.equal(porData.get('2026-10-18').situacao, 'domfer-banco')
  assert.equal(r.resumo.bancoHorasHe, 2)
  assert.equal(r.resumo.bancoHorasDomfer, 5.5)
  assert.equal(r.resumo.hePagasValor, 0)
  assert.equal(r.semanas[0].total, 1650)
})

caso('dias futuros: previsto, fora dos totais, sem projetar', () => {
  const r = espelhoControlePonto({
    inicio: '2026-10-19',
    fim: '2026-10-25',
    hojeISO: '2026-10-20',
    excecoes: [],
    feriados: [],
    ferias: [],
    config: CONFIG,
    todasExcecoes: [],
  })
  assert.deepStrictEqual(
    r.dias.map((d) => d.situacao),
    ['padrao', 'padrao', 'previsto', 'previsto', 'previsto', 'previsto', 'previsto'],
  )
  assert.equal(r.resumo.diasTrabalhados, 2) // 19 e 20/10 (passado conta)
  // Semana em curso: fixo cheio (sem rateio, regra da borda), sem projeção.
  assert.equal(r.resumo.valores, 1650)
  assert.equal(r.semanas[0].futura, false)
})

caso('semana 100% futura: dias previstos e bloco sem dinheiro', () => {
  const r = espelhoControlePonto({
    inicio: '2026-10-26',
    fim: '2026-11-01',
    hojeISO: '2026-10-20',
    excecoes: [],
    feriados: [],
    ferias: [],
    config: CONFIG,
    todasExcecoes: [],
  })
  assert.ok(r.dias.every((d) => d.situacao === 'previsto'))
  assert.equal(r.resumo.diasTrabalhados, 0)
  assert.equal(r.resumo.valores, 0)
  assert.equal(r.semanas[0].futura, true)
  assert.equal(r.semanas[0].total, null)
})

caso('mês com feriado: dia sem trabalho, desconto só no bloco semanal', () => {
  const r = espelhoControlePonto({
    ...SEMANA,
    hojeISO: HOJE,
    excecoes: [],
    feriados: ['2026-10-12'],
    ferias: [],
    config: CONFIG,
    todasExcecoes: [],
  })
  const seg = r.dias[0]
  assert.equal(seg.situacao, 'feriado')
  assert.equal(seg.horas, null)
  assert.equal(r.resumo.diasTrabalhados, 5)
  assert.equal(r.resumo.descFeriado, 275)
  assert.equal(r.semanas[0].total, 1650 - 275)
})

caso('período que cruza semanas: bloco cheio por semana, parcial sinalizada', () => {
  const r = espelhoControlePonto({
    inicio: '2026-10-14',
    fim: '2026-10-20',
    hojeISO: '2026-10-20',
    excecoes: [],
    feriados: [],
    ferias: [],
    config: CONFIG,
    todasExcecoes: [],
  })
  assert.equal(r.semanas.length, 2)
  assert.equal(r.semanas[0].segunda, '2026-10-12')
  assert.equal(r.semanas[0].parcial, true)
  assert.equal(r.semanas[0].total, 1650) // semana cheia, sem rateio
  assert.equal(r.semanas[1].segunda, '2026-10-19')
})

caso('férias: dia vira férias (fora dos trabalhados, sem horas)', () => {
  const r = espelhoControlePonto({
    ...SEMANA,
    hojeISO: HOJE,
    excecoes: [],
    feriados: [],
    ferias: [{ data_inicio: '2026-10-14', data_fim: '2026-10-14' }],
    config: CONFIG,
    todasExcecoes: [],
  })
  assert.equal(r.dias.find((d) => d.data === '2026-10-14').situacao, 'ferias')
  assert.equal(r.resumo.diasTrabalhados, 5)
})

caso('saldo do banco em duas datas bate com o saldo atual', () => {
  const todas = [
    { data: '2026-10-10', tipo: 'he', destino: 'banco', he: 2 },
    { data: '2026-10-12', tipo: 'falta', destino: 'banco', minutos_falta: 390 },
    { data: '2026-10-25', tipo: 'he', destino: 'banco', he: 1 }, // futura: fora
  ]
  assert.equal(saldoBancoAte(todas, '2026-10-11'), 120)
  assert.equal(saldoBancoAte(todas, '2026-10-12'), 120 - 390)
  assert.equal(saldoBancoAte(todas, '2026-10-20'), 120 - 390) // futura de fora = saldo atual
})

caso('bloco do banco: início, movimento no período, fim e FIFO', () => {
  const todas = [
    { data: '2026-10-01', tipo: 'he', destino: 'banco', he: 3 }, // 180 antes do período
    { data: '2026-10-13', tipo: 'he', destino: 'banco', he: 2 }, // 120 no período
    { data: '2026-10-14', tipo: 'falta', destino: 'banco', minutos_falta: 390 },
  ]
  const r = espelhoControlePonto({
    ...SEMANA,
    hojeISO: HOJE,
    excecoes: todas.filter((ex) => ex.data >= SEMANA.inicio && ex.data <= SEMANA.fim),
    feriados: [],
    ferias: [],
    config: CONFIG,
    todasExcecoes: todas,
  })
  assert.equal(r.banco.saldoInicio, 180)
  assert.equal(r.banco.creditosPeriodo, 120)
  assert.equal(r.banco.debitosPeriodo, 390)
  assert.equal(r.banco.saldoFim, 180 + 120 - 390)
  assert.equal(r.banco.variacao, 120 - 390)
  assert.equal(r.banco.faltas.length, 1)
  assert.equal(r.banco.faltas[0].status, 'pendente') // 180 < 390
})

caso('carga do resumo: mesma definição do Resumo/Home, sem HE/domfer', () => {
  const r = espelhoControlePonto({
    inicio: '2026-10-12',
    fim: '2026-10-18',
    hojeISO: '2026-10-20',
    excecoes: [
      { data: '2026-10-13', tipo: 'he', entrada: '20:30', saída: '05:00', horas: 8.5, he: 2, valor_he: 80, destino: 'pagamento' },
    ],
    feriados: [],
    ferias: [],
    config: CONFIG,
    todasExcecoes: [],
  })
  // 6 dias de carga (38h) cumpridos; HE fora da cumprida.
  assert.equal(r.resumo.carga.prevista, 38)
  assert.equal(r.resumo.carga.cumprida, 38)
  assert.equal(r.resumo.carga.pct, 100)
})

caso('carga com falta parcial e feriado; futuro fora do cálculo', () => {
  const r = espelhoControlePonto({
    inicio: '2026-10-12',
    fim: '2026-10-25',
    hojeISO: '2026-10-20',
    agora: new Date('2026-10-21T12:00:00'),
    excecoes: [
      { data: '2026-10-14', tipo: 'falta', destino: 'pagamento', minutos_falta: 195, valor_desconto: 137.5 },
    ],
    feriados: ['2026-10-12'],
    ferias: [],
    config: CONFIG,
    todasExcecoes: [],
  })
  // Dias de carga em 12–20/10: 13,14,15,16,19,20 (6×6,5=39) + sáb 17 (5,5);
  // feriado 12 já é fora da carga; falta parcial abate 195min (3,25h).
  assert.equal(r.resumo.carga.prevista, 39 + 5.5 - 3.25)
  // Cumprida: mesma base, menos o que não foi trabalhado.
  assert.equal(r.resumo.carga.cumprida, 39 + 5.5 - 3.25)
  assert.ok(r.resumo.carga.pct > 0 && r.resumo.carga.pct <= 100)
})

caso('falta futura: agendada, fora dos totais e dos débitos do período', () => {
  const r = espelhoControlePonto({
    inicio: '2026-10-12',
    fim: '2026-10-18',
    hojeISO: '2026-10-05',
    excecoes: [
      { data: '2026-10-14', tipo: 'falta', destino: 'banco', minutos_falta: 390, obs: 'dentista' },
    ],
    feriados: [],
    ferias: [],
    config: CONFIG,
    todasExcecoes: [
      { data: '2026-10-14', tipo: 'falta', destino: 'banco', minutos_falta: 390, obs: 'dentista' },
    ],
  })
  const d = r.dias.find((x) => x.data === '2026-10-14')
  assert.equal(d.agendada, true)
  assert.equal(d.faltaIntegral, true)
  assert.equal(r.resumo.faltas.banco.qtd, 0) // fora dos totais
  assert.equal(r.banco.debitosPeriodo, 0) // fora dos débitos do período
  assert.equal(r.banco.faltas.length, 1) // NA lista FIFO, com marca...
  assert.equal(r.banco.faltas[0].futura, true) // ...de agendada
})

caso('falta integral vs parcial (flag para a lista)', () => {
  const r = espelhoControlePonto({
    inicio: '2026-10-12',
    fim: '2026-10-18',
    hojeISO: '2026-10-20',
    excecoes: [
      { data: '2026-10-13', tipo: 'falta', destino: 'pagamento', minutos_falta: 390, valor_desconto: 275 },
      { data: '2026-10-14', tipo: 'falta', destino: 'pagamento', minutos_falta: 195, valor_desconto: 137.5 },
    ],
    feriados: [],
    ferias: [],
    config: CONFIG,
    todasExcecoes: [],
  })
  const porData = new Map(r.dias.map((d) => [d.data, d]))
  assert.equal(porData.get('2026-10-13').faltaIntegral, true)
  assert.equal(porData.get('2026-10-14').faltaIntegral, false)
})

console.log(`\n${ok} testes passaram, ${falhou} falharam.`)
if (falhou > 0) process.exit(1)
