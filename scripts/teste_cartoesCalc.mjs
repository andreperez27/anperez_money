// ============================================================================
// Testes da sugestão de cartão do Dashboard (src/lib/cartoesCalc.js)
// ============================================================================
// Execução (mesma convenção dos demais scripts do projeto):
//   node scripts/teste_cartoesCalc.mjs
//
// Escopo: funções PURAS — proximaDataFechamento (reaproveitando o espelho de
// calcular_mes_fatura), diasEntreDatas e a classificação/sugestão:
//   • primário: próximo fechamento a partir de hoje — o que fecha mais tarde
//     ganha;
//   • secundário: MESMA data → maior limite disponível ganha;
//   • 1 cartão ou 0 cartões comparáveis → sem sugestão (card intacto).
// Sem dependências externas — apenas node:assert e a lib pura.
import assert from 'node:assert/strict'
import {
  proximaDataFechamento,
  diasEntreDatas,
  classificarCartoesParaHoje,
  sugerirCartaoParaHoje,
} from '../src/lib/cartoesCalc.js'

let passou = 0
let falhou = 0

function caso(nome, funcao) {
  try {
    funcao()
    console.log(`ok      — ${nome}`)
    passou++
  } catch (e) {
    falhou++
    console.log(`FALHOU  — ${nome}`)
    console.log(`        ${e.message}`)
  }
}

// Data de referência fixa: 15/09/2026 (terça). Uma compra de hoje cai:
//   • fechamento dia 10  → fatura de OUTUBRO (fecha 10/10) — mais fôlego;
//   • fechamento dia 25  → fatura de SETEMBRO (fecha 25/09) — fecha primeiro.
const HOJE = '2026-09-15'

// --- proximaDataFechamento (derivada do mês de fatura de uma compra de hoje) --
caso('PDF1 — compra de hoje ANTES do fechamento: próxima = fechamento do mês atual', () => {
  assert.equal(proximaDataFechamento(25, HOJE), '2026-09-25')
})
caso('PDF2 — compra de hoje DEPOIS do fechamento: próxima = fechamento do mês seguinte', () => {
  assert.equal(proximaDataFechamento(10, HOJE), '2026-10-10')
})
caso('PDF3 — mês curto: fechamento 31 em fevereiro é clampado para o último dia', () => {
  assert.equal(proximaDataFechamento(31, '2026-02-10'), '2026-02-28')
})
caso('PDF4 — virada de ano: compra em dezembro após o fechamento cai em janeiro do ano seguinte', () => {
  assert.equal(proximaDataFechamento(15, '2026-12-20'), '2027-01-15')
})
caso('PDF5 — no dia exato do fechamento a próxima data é hoje', () => {
  assert.equal(proximaDataFechamento(15, '2026-09-15'), '2026-09-15')
})

// --- diasEntreDatas ----------------------------------------------------------
caso('D1 — diferença em dias entre hoje e a data alvo', () => {
  assert.equal(diasEntreDatas(HOJE, '2026-10-10'), 25)
})
caso('D2 — mesma data → 0 dias', () => {
  assert.equal(diasEntreDatas(HOJE, '2026-09-15'), 0)
})

// --- sugestão (critério primário: fecha mais tarde ganha) --------------------
caso('C1 — fechamentos diferentes: o que fecha mais TARDE a partir de hoje ganha', () => {
  const cartoes = [
    { id: 'a', nome: 'Nubank A (fecha 10)', dia_fechamento: 10 },
    { id: 'b', nome: 'Nubank B (fecha 25)', dia_fechamento: 25 },
  ]
  // B fecha 25/09; A só fecha em 10/10 → A dá mais fôlego até o vencimento.
  const win = sugerirCartaoParaHoje({ cartoes, limites: { a: 1000, b: 3000 }, hojeIso: HOJE })
  assert.equal(win.id, 'a')
  assert.equal(win.proximaDataFechamento, '2026-10-10')
  assert.equal(win.diasAteFechamento, 25)
  assert.equal(win.limiteDisponivel, 1000)
})

// --- sugestão (critério secundário: mesmo dia → maior limite ganha) ----------
caso('C2 — MESMO dia de fechamento: o de maior limite disponível ganha', () => {
  const cartoes = [
    { id: 'a', nome: 'Nubank A', dia_fechamento: 10, limite: 5000 },
    { id: 'b', nome: 'Nubank B', dia_fechamento: 10, limite: 8000 },
  ]
  const win = sugerirCartaoParaHoje({ cartoes, limites: { a: 4000, b: 7500 }, hojeIso: HOJE })
  assert.equal(win.id, 'b')
  assert.equal(win.limiteDisponivel, 7500)
  assert.equal(win.proximaDataFechamento, '2026-10-10')
})
caso('C2b — empate mesmo dia com limites iguais mantém a ordem da lista', () => {
  const cartoes = [
    { id: 'a', nome: 'Nubank A', dia_fechamento: 5, limite: 3000 },
    { id: 'b', nome: 'Nubank B', dia_fechamento: 5, limite: 3000 },
  ]
  const [first, second] = classificarCartoesParaHoje(cartoes, { a: 2800, b: 2800 }, HOJE)
  assert.equal(first.id, 'a')
  assert.equal(second.id, 'b')
})

// --- sugestão (fallback do limite nominal quando a RPC não veio) --------------
caso('C2c — limite da RPC ausente cai no limite nominal do cartão', () => {
  const cartoes = [
    { id: 'a', nome: 'Nubank A', dia_fechamento: 10, limite: 5000 },
    { id: 'b', nome: 'Nubank B', dia_fechamento: 10, limite: 8000 },
  ]
  // limites vazio (RPC falhou) → desempate pelo limite nominal (b maior).
  const win = sugerirCartaoParaHoje({ cartoes, limites: {}, hojeIso: HOJE })
  assert.equal(win.id, 'b')
  assert.equal(win.limiteDisponivel, 8000)
})

// --- sem comparação (card intacto) -------------------------------------------
caso('C3 — um único cartão ativo: sem sugestão (null)', () => {
  const cartoes = [{ id: 'a', nome: 'Nubank A', dia_fechamento: 10 }]
  assert.equal(sugerirCartaoParaHoje({ cartoes, limites: {}, hojeIso: HOJE }), null)
  assert.equal(classificarCartoesParaHoje(cartoes, {}, HOJE).length, 1)
})
caso('C4 — zero cartões ativos: sem sugestão (null)', () => {
  assert.equal(sugerirCartaoParaHoje({ cartoes: [], limites: {}, hojeIso: HOJE }), null)
})
caso('C4b — cartão sem dia_fechamento não entra na comparação', () => {
  const cartoes = [
    { id: 'a', nome: 'A', dia_fechamento: null },
    { id: 'b', nome: 'B', dia_fechamento: null },
  ]
  assert.equal(sugerirCartaoParaHoje({ cartoes, limites: {}, hojeIso: HOJE }), null)
})

// --- integração (o que aparece no card) --------------------------------------
caso('C5 — sugestão expõe os DOIS números: próxima data + limite disponível', () => {
  const cartoes = [
    { id: 'a', nome: 'Nubank PJ', dia_fechamento: 10 },
    { id: 'b', nome: 'Nubank PF', dia_fechamento: 25 },
  ]
  const win = sugerirCartaoParaHoje({ cartoes, limites: { a: 8500, b: 1200 }, hojeIso: HOJE })
  assert.equal(win.nome, 'Nubank PJ')
  assert.equal(win.proximaDataFechamento, '2026-10-10')
  assert.equal(win.limiteDisponivel, 8500)
})

console.log(`\n${passou} passou, ${falhou} falhou`)
process.exitCode = falhou > 0 ? 1 : 0