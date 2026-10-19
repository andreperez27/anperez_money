import assert from 'node:assert/strict'
import {
  adicionarDiasISO,
  dataPagamentoDaSemana,
  semanasJornadaNoHorizonte,
  chaveSemanaTrabalho,
  descricaoDaSemana,
  ehDescricaoAutomaticaJornada,
  valorDiferente,
  arredondarValor,
  valorPrevistoJornada,
} from '../src/lib/jornadaSemanal.js'
import { semanaDeTrabalhoDaData } from '../src/lib/reconciliacaoPonto.js'

// ============================================================================
// Testes do MODELO AUTOMÁTICO da entrada semanal do Ponto (19/10/2026).
// Cobrem a matemática pura que o usePlanejamentos orquestra:
//   • dataPagamentoDaSemana: quarta-feira da semana ISO SEGUINTE ao trabalho;
//   • round-trip com semanaDeTrabalhoDaData (vínculo explícito);
//   • horizonte de semanas (contíguo, começa na semana de trabalho corrente,
//     sobrevive à virada de ano ISO);
//   • chave de deduplicação e descrição "Pagamento da semana X";
//   • comparação/arredondamento em centavos.
// Rodar: node scripts/teste_jornadaSemanal.mjs
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

// dowIso: 0=segunda .. 6=domingo.
function dowIso(dataISO) {
  const [a, m, d] = dataISO.split('-').map(Number)
  return (new Date(Date.UTC(a, m - 1, d)).getUTCDay() + 6) % 7
}

// ---------------------------------------------------------------------------
// adicionarDiasISO
// ---------------------------------------------------------------------------
verificar('D1 — adicionarDiasISO soma dias corridos e cruza o mês', () => {
  assert.equal(adicionarDiasISO('2026-10-31', 1), '2026-11-01')
  assert.equal(adicionarDiasISO('2026-10-12', 9), '2026-10-21')
  assert.equal(adicionarDiasISO('2026-10-12', -7), '2026-10-05')
})

// ---------------------------------------------------------------------------
// dataPagamentoDaSemana — quarta-feira da semana ISO SEGUINTE
// ---------------------------------------------------------------------------
verificar('P1 — semana 42/2026 é paga na quarta 21/10/2026', () => {
  assert.equal(dataPagamentoDaSemana(2026, 42), '2026-10-21')
  assert.equal(dowIso('2026-10-21'), 2) // 0=seg → 2=quarta
})

verificar('P2 — toda semana é paga numa QUARTA-FEIRA (dow 2)', () => {
  for (let s = 1; s <= 52; s++) {
    assert.equal(dowIso(dataPagamentoDaSemana(2026, s)), 2, `semana ${s}`)
  }
})

verificar('P3 — round-trip: a semana paga é a semana de trabalho', () => {
  for (const s of [1, 10, 42, 52]) {
    const pago = dataPagamentoDaSemana(2026, s)
    assert.deepEqual(semanaDeTrabalhoDaData(pago), { ano: 2026, semana: s })
  }
})

verificar('P4 — virada de ano ISO: semana 52/2025 paga em 31/12/2025', () => {
  assert.equal(dataPagamentoDaSemana(2025, 52), '2025-12-31')
  assert.deepEqual(semanaDeTrabalhoDaData('2025-12-31'), { ano: 2025, semana: 52 })
  // Semana 1/2026 (começa 29/12/2025) paga na quarta 07/01/2026.
  assert.equal(dataPagamentoDaSemana(2026, 1), '2026-01-07')
})

// ---------------------------------------------------------------------------
// semanasJornadaNoHorizonte
// ---------------------------------------------------------------------------
verificar('H1 — horizonte começa na semana de trabalho CORRENTE (segunda 19/10)', () => {
  // Hoje segunda 19/10/2026 (semana ISO 43); o trabalho que paga a próxima
  // quarta é a semana 42/2026 (12–18/10) → pagamento 21/10.
  const semanas = semanasJornadaNoHorizonte({ hojeISO: '2026-10-19', semanas: 3 })
  assert.equal(semanas.length, 3)
  assert.deepEqual(semanas[0], {
    ano: 2026,
    semana: 42,
    inicio: '2026-10-12',
    fim: '2026-10-18',
    dataPrevista: '2026-10-21',
  })
  assert.equal(semanas[1].semana, 43)
  assert.equal(semanas[1].inicio, '2026-10-19')
  assert.equal(semanas[1].dataPrevista, '2026-10-28')
  assert.equal(semanas[2].dataPrevista, '2026-11-04')
})

verificar('H2 — horizonte é contíguo (passo de 7 dias, sem buraco)', () => {
  const semanas = semanasJornadaNoHorizonte({ hojeISO: '2026-10-19', semanas: 10 })
  for (let i = 1; i < semanas.length; i++) {
    assert.equal(semanas[i].inicio, adicionarDiasISO(semanas[i - 1].inicio, 7))
    assert.equal(semanas[i].dataPrevista, adicionarDiasISO(semanas[i - 1].dataPrevista, 7))
  }
})

verificar('H3 — horizonte sobrevive à virada de ano ISO (2025 → 2026)', () => {
  const semanas = semanasJornadaNoHorizonte({ hojeISO: '2025-12-29', semanas: 2 })
  // Semana ISO de 29/12/2025 = 1/2026 → trabalho = 52/2025.
  assert.deepEqual([semanas[0].ano, semanas[0].semana], [2025, 52])
  assert.equal(semanas[0].inicio, '2025-12-22')
  assert.equal(semanas[0].dataPrevista, '2025-12-31')
  assert.deepEqual([semanas[1].ano, semanas[1].semana], [2026, 1])
  assert.equal(semanas[1].inicio, '2025-12-29')
  assert.equal(semanas[1].dataPrevista, '2026-01-07')
})

verificar('H5 — semanasAnteriores recua o início (reconciliação de vencidas)', () => {
  const semanas = semanasJornadaNoHorizonte({
    hojeISO: '2026-10-19',
    semanas: 2,
    semanasAnteriores: 2,
  })
  assert.equal(semanas.length, 4)
  assert.deepEqual(semanas.map((s) => s.semana), [40, 41, 42, 43])
  assert.equal(semanas[0].inicio, '2026-09-28')
  assert.equal(semanas[0].dataPrevista, '2026-10-07')
})

verificar('H4 — cada semana tem janela seg–dom e pagamento na quarta', () => {
  const semanas = semanasJornadaNoHorizonte({ hojeISO: '2026-10-19', semanas: 8 })
  for (const s of semanas) {
    assert.equal(dowIso(s.inicio), 0, `início ${s.inicio}`)
    assert.equal(dowIso(s.fim), 6, `fim ${s.fim}`)
    assert.equal(dowIso(s.dataPrevista), 2, `pagamento ${s.dataPrevista}`)
    assert.equal(adicionarDiasISO(s.inicio, 6), s.fim)
  }
})

verificar('H6 — horizonte longo não repete semana (inclusive virada de ano)', () => {
  const semanas = semanasJornadaNoHorizonte({
    hojeISO: '2026-10-19',
    semanas: 60,
    semanasAnteriores: 4,
  })
  const chaves = semanas.map((s) => chaveSemanaTrabalho(s.ano, s.semana))
  assert.equal(new Set(chaves).size, chaves.length, 'há semana repetida no horizonte')
  // As datas de pagamento também são estritamente crescentes (1 por semana).
  for (let i = 1; i < semanas.length; i++) {
    assert.ok(semanas[i].dataPrevista > semanas[i - 1].dataPrevista)
  }
})

// ---------------------------------------------------------------------------
// chave / rótulo
// ---------------------------------------------------------------------------
verificar('C1 — chaveSemanaTrabalho deduplica por (ano, semana)', () => {
  assert.equal(chaveSemanaTrabalho(2026, 41), '2026-41')
})

verificar('C2 — descricaoDaSemana monta "Pagamento da semana X"', () => {
  assert.equal(descricaoDaSemana(41), 'Pagamento da semana 41')
  assert.equal(descricaoDaSemana(1), 'Pagamento da semana 1')
})

verificar('C3 — ehDescricaoAutomaticaJornada reconhece só as automáticas', () => {
  assert.equal(ehDescricaoAutomaticaJornada('Pagamento Semanal'), true)
  assert.equal(ehDescricaoAutomaticaJornada('Pagamento da semana 41'), true)
  assert.equal(ehDescricaoAutomaticaJornada('  Pagamento da semana 7 '), true)
  assert.equal(ehDescricaoAutomaticaJornada('Salário'), false)
  assert.equal(ehDescricaoAutomaticaJornada('Pagamento da semana X'), false)
  assert.equal(ehDescricaoAutomaticaJornada(''), false)
  assert.equal(ehDescricaoAutomaticaJornada(null), false)
})

// ---------------------------------------------------------------------------
// comparação / arredondamento
// ---------------------------------------------------------------------------
verificar('V1 — valorDiferente compara em centavos', () => {
  assert.equal(valorDiferente(2130, 2130.0), false)
  assert.equal(valorDiferente(2130.004, 2130), false)
  assert.equal(valorDiferente(2130, 2130.01), true)
  assert.equal(valorDiferente(2050, 2130), true)
})

verificar('V2 — arredondarValor fixa 2 casas', () => {
  assert.equal(arredondarValor(2130.126), 2130.13)
  assert.equal(arredondarValor(2130), 2130)
})

// ---------------------------------------------------------------------------
// valorPrevistoJornada — regra de exibição (19/10/2026)
// ---------------------------------------------------------------------------
verificar('R1 — semana FECHADA usa o valor REAL do Ponto (pode ser ZERO)', () => {
  assert.equal(valorPrevistoJornada({ fechada: true, fixoSemana: 1650, valorReal: 0 }), 0)
  assert.equal(valorPrevistoJornada({ fechada: true, fixoSemana: 1650, valorReal: 2130 }), 2130)
  assert.equal(valorPrevistoJornada({ fechada: true, fixoSemana: 1650, valorReal: 2130.126 }), 2130.13)
})

verificar('R2 — semana ABERTA mostra SÓ o fixo (ignora real/descontos)', () => {
  assert.equal(valorPrevistoJornada({ fechada: false, fixoSemana: 1650, valorReal: 0 }), 1650)
  assert.equal(valorPrevistoJornada({ fechada: false, fixoSemana: 1650, valorReal: 9999 }), 1650)
})

console.log(`\n${ok} ok, ${falhou} falha(s).`)
if (falhou > 0) process.exit(1)
