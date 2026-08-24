// ============================================================================
// Testes do módulo de semanas ISO 8601 (src/lib/semana.js)
// ============================================================================
// Execução (mesma convenção dos demais scripts do projeto):
//   node scripts/teste_semana.mjs
//
// Cobertura exigida pela ETAPA 06 / E2:
//   • exemplos obrigatórios (S33/S34/2026);
//   • virada de ano e anos com 52/53 semanas;
//   • navegação inversa (inicioDaSemanaIso);
//   • ida-e-volta em TODAS as semanas válidas de 2019–2033;
//   • varredura diária 2019-01-01 → 2033-12-31;
//   • rejeição de datas/formatos/semanas inválidas.
// Sem dependências externas — apenas node:assert.
import assert from 'node:assert/strict'
import { semanaIso, inicioDaSemanaIso } from '../src/lib/semana.js'

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

const MS_DIA = 86_400_000

// Converte 'YYYY-MM-DD' para o dia da semana ISO (0=segunda … 6=domingo),
// reimplementado aqui de forma independente para conferir a lib.
function dowDe(dataISO) {
  const [a, m, d] = dataISO.split('-').map(Number)
  return (new Date(Date.UTC(a, m - 1, d)).getUTCDay() + 6) % 7
}

// ---------------------------------------------------------------------------
// 1) Exemplos obrigatórios do pedido (objeto completo)
caso('exemplo obrigatório: 2026-08-10 = S33/2026 (10/08→16/08)', () => {
  assert.deepEqual(semanaIso('2026-08-10'), {
    ano: 2026,
    semana: 33,
    inicio: '2026-08-10',
    fim: '2026-08-16',
  })
})
caso('exemplo obrigatório: 2026-08-17 = S34/2026 (17/08→23/08)', () => {
  assert.deepEqual(semanaIso('2026-08-17'), {
    ano: 2026,
    semana: 34,
    inicio: '2026-08-17',
    fim: '2026-08-23',
  })
})

// ---------------------------------------------------------------------------
// 2) Virada de ano
caso('virada: 29–31/12/2025 e 01–04/01/2026 = S01/2026; 05/01 = S02', () => {
  for (const dia of ['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']) {
    const s = semanaIso(dia)
    assert.equal(`${s.ano}-W${s.semana}`, '2026-W1', `${dia} deveria ser 2026-W1`)
  }
  const seg = semanaIso('2026-01-05')
  assert.equal(`${seg.ano}-W${seg.semana}`, '2026-W2')
})

// ---------------------------------------------------------------------------
// 3) Ano anterior / 53 semanas
caso('2027-01-01 pertence a S53/2026', () => {
  const s = semanaIso('2027-01-01')
  assert.equal(s.ano, 2026)
  assert.equal(s.semana, 53)
})
caso('ano longo: 28/12/2026, 01/01 e 03/01/2027 = S53/2026; 04/01/2027 = S01/2027', () => {
  for (const dia of ['2026-12-28', '2027-01-01', '2027-01-03']) {
    const s = semanaIso(dia)
    assert.equal(`${s.ano}-W${s.semana}`, '2026-W53', `${dia} deveria ser 2026-W53`)
  }
  const s = semanaIso('2027-01-04')
  assert.equal(s.ano, 2027)
  assert.equal(s.semana, 1)
})

// ---------------------------------------------------------------------------
// 4) Navegação inversa
caso('navegação: inicioDaSemanaIso(2026,33)=2026-08-10 e (2026,34)=2026-08-17', () => {
  assert.equal(inicioDaSemanaIso(2026, 33), '2026-08-10')
  assert.equal(inicioDaSemanaIso(2026, 34), '2026-08-17')
})
caso('navegação na virada: inicioDaSemanaIso(2026,1)=2025-12-29', () => {
  assert.equal(inicioDaSemanaIso(2026, 1), '2025-12-29')
})

// ---------------------------------------------------------------------------
// 5) Contagem oficial de semanas por ano (52 ou 53) em 2019–2033
caso('semanas por ano 2019–2033 batem com o calendário ISO oficial', () => {
  // Anos longos (53 semanas) no intervalo: 2020, 2026 e 2032.
  const esperado = {}
  for (let a = 2019; a <= 2033; a++) esperado[a] = [2020, 2026, 2032].includes(a) ? 53 : 52

  const contagem = {}
  for (let a = 2019; a <= 2033; a++) {
    let s = 1
    while (true) {
      let inicio
      try {
        inicio = inicioDaSemanaIso(a, s + 1)
      } catch {
        break // não existe s+1 → s é a última do ano
      }
      assert.equal(dowDe(inicio), 0, `semana ${s + 1}/${a} deveria começar numa segunda`)
      s++
      if (s > 60) throw new Error('loop infinito na contagem de semanas')
    }
    contagem[a] = s
  }
  assert.deepEqual(contagem, esperado)
})

// ---------------------------------------------------------------------------
// 6) Ida-e-volta em todas as semanas válidas de 2019–2033
caso('ida-e-volta: semanaIso(inicioDaSemanaIso(a,s)) preserva a dupla (a,s)', () => {
  for (let a = 2019; a <= 2033; a++) {
    for (let s = 1; ; s++) {
      let inicio
      try {
        inicio = inicioDaSemanaIso(a, s)
      } catch {
        break
      }
      const volta = semanaIso(inicio)
      assert.equal(volta.ano, a, `ano divergiu em ${inicio}`)
      assert.equal(volta.semana, s, `semana divergiu em ${inicio}`)
      if (s === 53) break
    }
  }
})

// ---------------------------------------------------------------------------
// 7) Varredura ampla: todos os dias de 2019-01-01 até 2033-12-31
caso('varredura 2019–2033 (5.479 dias): intervalos, dias da semana e consistência', () => {
  let ts = Date.UTC(2019, 0, 1)
  const fimVarredura = Date.UTC(2033, 11, 31)
  let total = 0

  while (ts <= fimVarredura) {
    const dataISO = new Date(ts).toISOString().slice(0, 10)
    const s = semanaIso(dataISO)

    // formato das pontas
    assert.match(s.inicio, /^\d{4}-\d{2}-\d{2}$/)
    assert.match(s.fim, /^\d{4}-\d{2}-\d{2}$/)

    // início é segunda (dow 0), fim é domingo (dow 6) e duram exatamente 7 dias
    assert.equal(dowDe(s.inicio), 0, `${dataISO}: início ${s.inicio} não é segunda`)
    assert.equal(dowDe(s.fim), 6, `${dataISO}: fim ${s.fim} não é domingo`)
    const [ia, im, id] = s.inicio.split('-').map(Number)
    const [fa, fm, fd] = s.fim.split('-').map(Number)
    assert.equal(Date.UTC(fa, fm - 1, fd) - Date.UTC(ia, im - 1, id), 6 * MS_DIA)

    // a data original pertence ao intervalo (inclusive as pontas)
    const inicioTs = Date.UTC(ia, im - 1, id)
    const fimTs = Date.UTC(fa, fm - 1, fd)
    assert.ok(inicioTs <= ts && ts <= fimTs, `${dataISO} fora do próprio intervalo`)

    // consistência da semana nas duas pontas (mesma dupla ano+semana)
    const si = semanaIso(s.inicio)
    const sf = semanaIso(s.fim)
    assert.deepEqual([si.ano, si.semana], [s.ano, s.semana])
    assert.deepEqual([sf.ano, sf.semana], [s.ano, s.semana])

    // ida-e-volta pela semana correspondente
    assert.equal(inicioDaSemanaIso(s.ano, s.semana), s.inicio)

    total++
    ts += MS_DIA
  }
  assert.equal(total, 5479)
})

// ---------------------------------------------------------------------------
// 8) Validações de entrada
caso('datas civis inválidas são rejeitadas com erro', () => {
  for (const ruim of ['2026-02-30', '2026-13-01', 'abc', '', '10/08/2026', '2026-2-01', '2026-08-10 ', null, undefined]) {
    assert.throws(() => semanaIso(ruim), undefined, `deveria rejeitar ${JSON.stringify(ruim)}`)
  }
})
caso('semanas inexistentes/inválidas na navegação são rejeitadas', () => {
  assert.throws(() => inicioDaSemanaIso(2027, 53)) // 2027 tem 52 semanas
  assert.throws(() => inicioDaSemanaIso(2026, 54))
  assert.throws(() => inicioDaSemanaIso(2026, 0))
  assert.throws(() => inicioDaSemanaIso(2026.5, 3))
  assert.throws(() => inicioDaSemanaIso('2026', '33'))
})

console.log(`\n${passou} ok, ${falhou} falharam`)
process.exit(falhou > 0 ? 1 : 0)
