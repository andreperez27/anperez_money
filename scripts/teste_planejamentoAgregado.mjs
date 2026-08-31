// ============================================================================
// Testes da agregação de planejamentos (src/lib/planejamentoAgregado.js)
// ============================================================================
// Execução (mesma convenção dos demais scripts):
//   node scripts/teste_planejamentoAgregado.mjs
//
// Cobertura exigida pela ETAPA 06 / F1:
//   • lista vazia → [] (ambos os agrupadores);
//   • um item / vários no mesmo grupo;
//   • meses e semanas diferentes, com entrada FORA DE ORDEM;
//   • virada de ano civil E virada de ano ISO (29/12/2025 = W01/2026!);
//   • limites corretos dos grupos (bissexto, 30/31 dias);
//   • CONSISTÊNCIA: soma dos grupos = total original, sem perda/duplicação
//     (identidade por referência — itens não são copiados nem recriados);
//   • dados inválidos lançam erro CLARO (nunca descarte silencioso).
// Sem dependências externas — apenas node:assert.
import assert from 'node:assert/strict'
import { agruparPorMes, agruparPorSemanaISO, agruparPorAno } from '../src/lib/planejamentoAgregado.js'

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

const item = (data_prevista, descricao = `item ${data_prevista}`) => ({
  data_prevista,
  descricao,
})

// ---------------------------------------------------------------------------
// agruparPorMes
caso('M1 — lista vazia devolve [] (nunca null)', () => {
  assert.deepEqual(agruparPorMes([]), [])
})
caso('M2 — undefined é tratado como lista vazia', () => {
  assert.deepEqual(agruparPorMes(undefined), [])
})
caso('M3 — um item → um grupo com os limites certos do mês', () => {
  const origem = item('2026-08-05', 'único')
  const [g] = agruparPorMes([origem])
  assert.equal(g.chave, '2026-08')
  assert.equal(g.inicio, '2026-08-01')
  assert.equal(g.fim, '2026-08-31')
  assert.equal(g.itens.length, 1)
  assert.equal(g.itens[0], origem) // MESMA referência — sem cópia
})
caso('M4 — vários itens do mesmo mês caem juntos', () => {
  const itens = [
    item('2026-08-25'),
    item('2026-08-01'),
    item('2026-08-18'),
    item('2026-08-05'),
  ]
  const grupos = agruparPorMes(itens)
  assert.equal(grupos.length, 1)
  assert.equal(grupos[0].itens.length, 4)
})
caso('M5 — meses diferentes FORA DE ORDEM saem cronológicos', () => {
  const grupos = agruparPorMes([
    item('2026-08-10'),
    item('2026-07-25'),
    item('2026-09-01'),
    item('2026-07-01'),
  ])
  assert.deepEqual(
    grupos.map((g) => g.chave),
    ['2026-07', '2026-08', '2026-09'],
  )
  assert.equal(grupos[0].inicio, '2026-07-01')
  assert.equal(grupos[0].fim, '2026-07-31')
  assert.equal(grupos[1].fim, '2026-08-31')
  assert.equal(grupos[2].fim, '2026-09-30')
})
caso('M6 — mudança de ano: dezembro/2025 antes de janeiro/2026', () => {
  const grupos = agruparPorMes([item('2026-01-03'), item('2025-12-31')])
  assert.deepEqual(
    grupos.map((g) => g.chave),
    ['2025-12', '2026-01'],
  )
  assert.equal(grupos[0].fim, '2025-12-31')
  assert.equal(grupos[1].inicio, '2026-01-01')
})
caso('M7 — fevereiro bissexto fecha em 29 (2024)', () => {
  const [g] = agruparPorMes([item('2024-02-29')])
  assert.equal(g.fim, '2024-02-29')
})

// ---------------------------------------------------------------------------
// agruparPorSemanaISO
caso('S1 — lista vazia devolve [] (nunca null)', () => {
  assert.deepEqual(agruparPorSemanaISO([]), [])
})
caso('S2 — uma semana ISO completa: ano/semana/início/fim corretos', () => {
  const [g] = agruparPorSemanaISO([item('2026-08-26')])
  assert.equal(g.ano, 2026)
  assert.equal(g.semana, 35)
  assert.equal(g.inicio, '2026-08-24')
  assert.equal(g.fim, '2026-08-30')
  assert.equal(g.chave, '2026-W35')
})
caso('S3 — segunda e domingo da mesma semana caem juntos', () => {
  const grupos = agruparPorSemanaISO([item('2026-08-24'), item('2026-08-30')])
  assert.equal(grupos.length, 1)
  assert.equal(grupos[0].itens.length, 2)
})
caso('S4 — semanas vizinhas formam grupos distintos e ordenados', () => {
  const grupos = agruparPorSemanaISO([
    item('2026-08-31'), // S36
    item('2026-08-24'), // S35
    item('2026-08-17'), // S34
  ])
  assert.deepEqual(
    grupos.map((g) => g.semana),
    [34, 35, 36],
  )
})
caso('S5 — virada de ano ISO: 29/12/2025 é W01 DE 2026', () => {
  const grupos = agruparPorSemanaISO([item('2025-12-29'), item('2026-01-04')])
  assert.equal(grupos.length, 1)
  assert.deepEqual(
    { chave: grupos[0].chave, ano: grupos[0].ano, semana: grupos[0].semana },
    { chave: '2026-W01', ano: 2026, semana: 1 },
  )
})
caso('S6 — W52/2025 vem ANTES de W01/2026 na ordenação', () => {
  const grupos = agruparPorSemanaISO([
    item('2026-01-02'), // W01/2026
    item('2025-12-23'), // W52/2025
  ])
  assert.deepEqual(
    grupos.map((g) => g.chave),
    ['2025-W52', '2026-W01'],
  )
})

// ---------------------------------------------------------------------------
// agruparPorAno
caso('Y1 — lista vazia devolve [] (nunca null)', () => {
  assert.deepEqual(agruparPorAno([]), [])
})
caso('Y2 — um ano completo: chave/ano/limites corretos', () => {
  const origem = item('2026-08-26', 'único')
  const [g] = agruparPorAno([origem])
  assert.equal(g.chave, '2026')
  assert.equal(g.ano, 2026)
  assert.equal(g.inicio, '2026-01-01')
  assert.equal(g.fim, '2026-12-31')
  assert.equal(g.itens.length, 1)
  assert.equal(g.itens[0], origem) // MESMA referência — sem cópia
})
caso('Y3 — itens de anos diferentes FORA DE ORDEM saem cronológicos', () => {
  const grupos = agruparPorAno([
    item('2026-08-10'),
    item('2025-01-01'),
    item('2027-03-03'),
    item('2025-12-31'),
  ])
  assert.deepEqual(
    grupos.map((g) => g.chave),
    ['2025', '2026', '2027'],
  )
  assert.equal(grupos[0].fim, '2025-12-31')
  assert.equal(grupos[1].inicio, '2026-01-01')
  assert.equal(grupos[2].fim, '2027-12-31')
})
caso('Y4 — primeiro e último dia do ano caem no mesmo grupo', () => {
  const grupos = agruparPorAno([item('2026-12-31'), item('2026-01-01')])
  assert.equal(grupos.length, 1)
  assert.equal(grupos[0].itens.length, 2)
})
caso('Y5 — ano bissexto não quebra os limites (2024 → 2025)', () => {
  const grupos = agruparPorAno([item('2024-02-29'), item('2025-06-15')])
  assert.deepEqual(
    grupos.map((g) => g.chave),
    ['2024', '2025'],
  )
  assert.equal(grupos[0].fim, '2024-12-31')
  assert.equal(grupos[1].fim, '2025-12-31')
})

// ---------------------------------------------------------------------------
// CONSISTÊNCIA — nenhuma perda, nenhuma duplicação (por referência)
caso('C1 — varredura: soma dos grupos = total de itens (mês)', () => {
  const datas = []
  for (let d = 1; d <= 28; d++) {
    datas.push(item(`2026-${String(((d % 3) + 6)).padStart(2, '0')}-${String(d).padStart(2, '0')}`))
  }
  const grupos = agruparPorMes(datas)
  const total = grupos.reduce((soma, g) => soma + g.itens.length, 0)
  assert.equal(total, datas.length)
})
caso('C2 — cada item aparece EXATAMENTE uma vez (sem duplicação)', () => {
  const itens = [
    item('2026-08-25'),
    item('2026-07-01'),
    item('2026-08-30'),
    item('2025-12-29'),
  ]
  const grupos = [...agruparPorMes(itens), ...agruparPorSemanaISO(itens), ...agruparPorAno(itens)]
  const vistas = new Map()
  for (const g of grupos) {
    for (const it of g.itens) {
      vistas.set(it, (vistas.get(it) ?? 0) + 1)
    }
  }
  assert.equal(vistas.size, itens.length) // nenhum item perdido
  for (const vezes of vistas.values()) {
    assert.equal(vezes, 3) // 1x em cada agrupador, nunca 2x no mesmo
  }
})
caso('C3 — associação correta: o item está no grupo da SUA data', () => {
  const alvo = item('2026-07-15', 'alvo específico')
  const grupos = agruparPorMes([item('2026-08-01'), alvo, item('2026-09-09')])
  const grupoJulho = grupos.find((g) => g.chave === '2026-07')
  assert.equal(grupoJulho.itens.includes(alvo), true)
  assert.equal(grupoJulho.itens.length, 1)
})

// ---------------------------------------------------------------------------
// DADOS INVÁLIDOS — erro claro, nunca descarte silencioso
caso('I1 — item SEM data_prevista lança erro citando o índice', () => {
  assert.throws(() => agruparPorMes([{ descricao: 'sem data' }]), /itens\[0\]/)
})
caso('I2 — data malformada lança erro claro', () => {
  assert.throws(() => agruparPorSemanaISO([item('32/08/2026')]), /Data inválida/)
})
caso('I3 — data inexistente no calendário é rejeitada (2026-02-30)', () => {
  assert.throws(() => agruparPorMes([item('2026-02-30')]), /Data inexistente/)
})
caso('I4 — entrada que não é lista é rejeitada', () => {
  assert.throws(() => agruparPorMes(null), /lista/)
  assert.throws(() => agruparPorSemanaISO('não sou lista'), /lista/)
  assert.throws(() => agruparPorAno({}), /lista/)
})

// ---------------------------------------------------------------------------
console.log(`\n${passou} ok, ${falhou} falharam`)
if (falhou > 0) process.exitCode = 1
