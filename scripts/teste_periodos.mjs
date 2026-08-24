// ============================================================================
// Testes dos períodos do Planejamento (src/lib/periodos.js)
// ============================================================================
// Execução (mesma convenção dos demais scripts):
//   node scripts/teste_periodos.mjs
//
// Cobertura exigida pela ETAPA 06 / F1:
//   • semana ISO: definição, ±semanas, viradas de mês/ano, semanas 52/53;
//   • mês civil: fevereiro bissexto/não bissexto, 30/31 dias, dez↔jan;
//   • trimestre: Q1..Q4 e travessias de ano;
//   • semestre: S1/S2 e travessias de ano;
//   • ehPeriodoAtual com referência EXPLÍCITA (determinístico, sem relógio);
//   • rejeição de tipos/datas/deltas inválidos.
// Sem dependências externas — apenas node:assert.
import assert from 'node:assert/strict'
import {
  definirPeriodo,
  deslocarPeriodo,
  ehPeriodoAtual,
} from '../src/lib/periodos.js'

let passou = 0
let falhou = 0

function caso(nome, funcao) {
  try {
    funcao()
    console.log(`ok      — ${nome}`)
    passou++
  } catch (e) {
    console.error(`FALHOU  — ${nome}: ${e.message}`)
    falhou++
  }
}

// ---------------------------------------------------------------------------
// SEMANA — delega na fonte única semana.js
caso('S1 — semana simples: 26/08/2026 = S35/2026 (24/08→30/08)', () => {
  assert.deepEqual(definirPeriodo('semana', '2026-08-26'), {
    tipo: 'semana',
    ano: 2026,
    semana: 35,
    inicio: '2026-08-24',
    fim: '2026-08-30',
  })
})
caso('S2 — semana seguinte cruza o mês: +1 → 31/08→06/09 (S36)', () => {
  const p = definirPeriodo('semana', '2026-08-26')
  assert.deepEqual(deslocarPeriodo('semana', p, 1), {
    tipo: 'semana', ano: 2026, semana: 36,
    inicio: '2026-08-31', fim: '2026-09-06',
  })
})
caso('S3 — semana anterior: −1 → S34/2026 (17/08→23/08)', () => {
  const p = definirPeriodo('semana', '2026-08-26')
  const a = deslocarPeriodo('semana', p, -1)
  assert.equal(a.inicio, '2026-08-17')
  assert.equal(a.fim, '2026-08-23')
  assert.equal(a.semana, 34)
})
caso('S4 — ida-e-volta: deslocar(+1,−1) devolve o mesmo período', () => {
  const p = definirPeriodo('semana', '2026-08-26')
  assert.deepEqual(deslocarPeriodo('semana', deslocarPeriodo('semana', p, 1), -1), p)
})
caso('S5 — virada de ano: 29/12/2025 pertence à S01/2026 (29/12→04/01)', () => {
  assert.deepEqual(definirPeriodo('semana', '2025-12-29'), {
    tipo: 'semana', ano: 2026, semana: 1,
    inicio: '2025-12-29', fim: '2026-01-04',
  })
})
caso('S6 — S01/2026 −1 cai na última semana DE 2025 (S52)', () => {
  const p = definirPeriodo('semana', '2025-12-29')
  const a = deslocarPeriodo('semana', p, -1)
  assert.deepEqual(
    { ano: a.ano, semana: a.semana, inicio: a.inicio, fim: a.fim },
    { ano: 2025, semana: 52, inicio: '2025-12-22', fim: '2025-12-28' },
  )
})
caso('S7 — semana 53 existe quando o ano ISO é longo (2020)', () => {
  assert.deepEqual(definirPeriodo('semana', '2020-12-31'), {
    tipo: 'semana', ano: 2020, semana: 53,
    inicio: '2020-12-28', fim: '2021-01-03',
  })
})
caso('S8 — S53/2020 +1 vira S01/2021 (não inventa 54)', () => {
  const p = definirPeriodo('semana', '2020-12-31')
  const a = deslocarPeriodo('semana', p, 1)
  assert.equal(a.ano, 2021)
  assert.equal(a.semana, 1)
  assert.equal(a.inicio, '2021-01-04')
})

// ---------------------------------------------------------------------------
// MÊS — calendário civil
caso('M1 — janeiro tem 31 dias (01/01→31/01)', () => {
  assert.deepEqual(definirPeriodo('mes', '2026-01-15'), {
    tipo: 'mes', ano: 2026, mes: 1, inicio: '2026-01-01', fim: '2026-01-31',
  })
})
caso('M2 — fevereiro NÃO bissexto termina em 28 (2026)', () => {
  const p = definirPeriodo('mes', '2026-02-10')
  assert.equal(p.fim, '2026-02-28')
})
caso('M3 — fevereiro BISSEXTO termina em 29 (2024)', () => {
  const p = definirPeriodo('mes', '2024-02-10')
  assert.equal(p.fim, '2024-02-29')
})
caso('M4 — abril tem 30 dias', () => {
  const p = definirPeriodo('mes', '2026-04-20')
  assert.equal(p.fim, '2026-04-30')
})
caso('M5 — dezembro tem 31 dias', () => {
  const p = definirPeriodo('mes', '2026-12-05')
  assert.equal(p.fim, '2026-12-31')
})
caso('M6 — dezembro +1 → janeiro do ano seguinte (01/01→31/01)', () => {
  const p = definirPeriodo('mes', '2026-12-15')
  assert.deepEqual(deslocarPeriodo('mes', p, 1), {
    tipo: 'mes', ano: 2027, mes: 1, inicio: '2027-01-01', fim: '2027-01-31',
  })
})
caso('M7 — janeiro −1 → dezembro do ano anterior', () => {
  const p = definirPeriodo('mes', '2026-01-15')
  const a = deslocarPeriodo('mes', p, -1)
  assert.deepEqual({ ano: a.ano, mes: a.mes, inicio: a.inicio, fim: a.fim }, {
    ano: 2025, mes: 12, inicio: '2025-12-01', fim: '2025-12-31',
  })
})

// ---------------------------------------------------------------------------
// TRIMESTRE — Q1..Q4
caso('T1 — Q1: 15/02/2026 → 01/01→31/03', () => {
  assert.deepEqual(definirPeriodo('trimestre', '2026-02-15'), {
    tipo: 'trimestre', ano: 2026, trimestre: 1, inicio: '2026-01-01', fim: '2026-03-31',
  })
})
caso('T2 — Q2: 20/05/2026 → 01/04→30/06', () => {
  assert.deepEqual(definirPeriodo('trimestre', '2026-05-20'), {
    tipo: 'trimestre', ano: 2026, trimestre: 2, inicio: '2026-04-01', fim: '2026-06-30',
  })
})
caso('T3 — Q3: 26/08/2026 → 01/07→30/09', () => {
  assert.deepEqual(definirPeriodo('trimestre', '2026-08-26'), {
    tipo: 'trimestre', ano: 2026, trimestre: 3, inicio: '2026-07-01', fim: '2026-09-30',
  })
})
caso('T4 — Q4: 10/11/2026 → 01/10→31/12', () => {
  assert.deepEqual(definirPeriodo('trimestre', '2026-11-10'), {
    tipo: 'trimestre', ano: 2026, trimestre: 4, inicio: '2026-10-01', fim: '2026-12-31',
  })
})
caso('T5 — Q4 +1 → Q1 do ANO SEGUINTE', () => {
  const p = definirPeriodo('trimestre', '2026-11-10')
  assert.deepEqual(deslocarPeriodo('trimestre', p, 1), {
    tipo: 'trimestre', ano: 2027, trimestre: 1, inicio: '2027-01-01', fim: '2027-03-31',
  })
})
caso('T6 — Q1 −1 → Q4 do ANO ANTERIOR', () => {
  const p = definirPeriodo('trimestre', '2026-02-15')
  const a = deslocarPeriodo('trimestre', p, -1)
  assert.deepEqual({ ano: a.ano, trimestre: a.trimestre, inicio: a.inicio, fim: a.fim }, {
    ano: 2025, trimestre: 4, inicio: '2025-10-01', fim: '2025-12-31',
  })
})

// ---------------------------------------------------------------------------
// SEMESTRE — S1/S2
caso('V1 — S1: 15/03/2026 → 01/01→30/06', () => {
  assert.deepEqual(definirPeriodo('semestre', '2026-03-15'), {
    tipo: 'semestre', ano: 2026, semestre: 1, inicio: '2026-01-01', fim: '2026-06-30',
  })
})
caso('V2 — S2: 26/08/2026 → 01/07→31/12', () => {
  assert.deepEqual(definirPeriodo('semestre', '2026-08-26'), {
    tipo: 'semestre', ano: 2026, semestre: 2, inicio: '2026-07-01', fim: '2026-12-31',
  })
})
caso('V3 — S2 +1 → S1 do ANO SEGUINTE', () => {
  const p = definirPeriodo('semestre', '2026-08-26')
  assert.deepEqual(deslocarPeriodo('semestre', p, 1), {
    tipo: 'semestre', ano: 2027, semestre: 1, inicio: '2027-01-01', fim: '2027-06-30',
  })
})
caso('V4 — S1 −1 → S2 do ANO ANTERIOR', () => {
  const p = definirPeriodo('semestre', '2026-03-15')
  const a = deslocarPeriodo('semestre', p, -1)
  assert.deepEqual({ ano: a.ano, semestre: a.semestre, inicio: a.inicio, fim: a.fim }, {
    ano: 2025, semestre: 2, inicio: '2025-07-01', fim: '2025-12-31',
  })
})

// ---------------------------------------------------------------------------
// PERÍODO ATUAL — sempre com referência EXPLÍCITA (sem relógio)
caso('P1 — data dentro do período → true', () => {
  const p = definirPeriodo('mes', '2026-08-01')
  assert.equal(ehPeriodoAtual('mes', p, '2026-08-26'), true)
})
caso('P2 — data ANTERIOR ao período → false', () => {
  const p = definirPeriodo('mes', '2026-08-01')
  assert.equal(ehPeriodoAtual('mes', p, '2026-07-31'), false)
})
caso('P3 — data POSTERIOR ao período → false', () => {
  const p = definirPeriodo('mes', '2026-08-01')
  assert.equal(ehPeriodoAtual('mes', p, '2026-09-01'), false)
})
caso('P4 — LIMITE inicial conta como dentro (inclusivo)', () => {
  const p = definirPeriodo('mes', '2026-08-01')
  assert.equal(ehPeriodoAtual('mes', p, '2026-08-01'), true)
})
caso('P5 — LIMITE final conta como dentro (inclusivo)', () => {
  const p = definirPeriodo('mes', '2026-08-01')
  assert.equal(ehPeriodoAtual('mes', p, '2026-08-31'), true)
})
caso('P6 — funciona igual para semana (limites inclusivos)', () => {
  const p = definirPeriodo('semana', '2026-08-26')
  assert.equal(ehPeriodoAtual('semana', p, '2026-08-24'), true)
  assert.equal(ehPeriodoAtual('semana', p, '2026-08-30'), true)
  assert.equal(ehPeriodoAtual('semana', p, '2026-08-31'), false)
})
caso('P7 — funciona igual para semestre', () => {
  const p = definirPeriodo('semestre', '2026-08-26')
  assert.equal(ehPeriodoAtual('semestre', p, '2026-12-31'), true)
  assert.equal(ehPeriodoAtual('semestre', p, '2027-01-01'), false)
})

// ---------------------------------------------------------------------------
// REJEIÇÕES — nada mascarado silenciosamente
caso('R1 — tipo desconhecido é rejeitado', () => {
  assert.throws(() => definirPeriodo('bimestre', '2026-08-01'), /Tipo de período desconhecido/)
})
caso('R2 — data malformada é rejeitada', () => {
  assert.throws(() => definirPeriodo('mes', '26-08-01'), /formato YYYY-MM-DD/)
})
caso('R3 — data inexistente é rejeitada (2026-02-30)', () => {
  assert.throws(() => definirPeriodo('mes', '2026-02-30'), /Data inexistente/)
})
caso('R4 — delta fracionário é rejeitado', () => {
  const p = definirPeriodo('mes', '2026-08-01')
  assert.throws(() => deslocarPeriodo('mes', p, 1.5), /inteiro/)
})
caso('R5 — período do tipo errado é rejeitado', () => {
  const semana = definirPeriodo('semana', '2026-08-26')
  assert.throws(() => deslocarPeriodo('mes', semana, 1), /incompatível/)
})
caso('R6 — referência inválida em ehPeriodoAtual é rejeitada', () => {
  const p = definirPeriodo('mes', '2026-08-01')
  assert.throws(() => ehPeriodoAtual('mes', p, 'ontem'), /YYYY-MM-DD/)
})

// ---------------------------------------------------------------------------
console.log(`\n${passou} ok, ${falhou} falharam`)
if (falhou > 0) process.exitCode = 1
