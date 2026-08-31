import assert from 'node:assert/strict'
import {
  calcularMesFatura,
  vencimentoISO,
  montarItemFatura,
  montarItensFatura,
} from '../src/lib/faturaPlanejamento.js'

// ============================================================================
// Testes da FATURA AUTOMÁTICA NO PLANEJAMENTO (lib pura faturaPlanejamento.js).
// Rodar: node scripts/teste_faturaPlanejamento.mjs
//
// Escopo: funções PURAS de src/lib/faturaPlanejamento.js — inclui o espelho de
// calcular_mes_fatura (mês curto, virada de ano), o vencimento e a montagem de
// itens de fatura (uma por cartão/mês) com dado real + previstos.
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

// --- calcularMesFatura (espelho do SQL) --------------------------------------
verificar('FC1 — compra antes do fechamento vai para o mês atual', () => {
  assert.equal(calcularMesFatura('2026-03-10', 15), '2026-03')
})
verificar('FC2 — compra após o fechamento vai para o mês seguinte', () => {
  assert.equal(calcularMesFatura('2026-03-20', 15), '2026-04')
})
verificar('FC3 — no dia exato do fechamento fica no mês atual', () => {
  assert.equal(calcularMesFatura('2026-03-15', 15), '2026-03')
})
verificar('FC4 — virada de ano (dezembro após fechamento → janeiro do ano seguinte)', () => {
  assert.equal(calcularMesFatura('2026-12-20', 15), '2027-01')
})
verificar('FC5 — mês curto: fechamento 31 em fevereiro vira o último dia (28)', () => {
  // 10/fev com fechamento 31 → dia efetivo = 28; 10 <= 28 → fevereiro.
  assert.equal(calcularMesFatura('2026-02-10', 31), '2026-02')
})
verificar('FC6 — mês curto: compra após o último dia efetivo vai para o mês seguinte', () => {
  // dia efetivo de fev = 28; dia 29/fev (fora do mês) não existe, mas testamos
  // o caso conceitual com fechamento 27: dia 28 > 27 → março.
  assert.equal(calcularMesFatura('2026-02-28', 27), '2026-03')
})

// --- vencimentoISO ----------------------------------------------------------
verificar('F1 — vencimento básico (dia 10 de 2026-03)', () => {
  assert.equal(vencimentoISO('2026-03', 10), '2026-03-10')
})
verificar('F2 — clamp para mês curto (dia 31 em 2026-04 → 30)', () => {
  assert.equal(vencimentoISO('2026-04', 31), '2026-04-30')
})
verificar('F3 — não oferece dia inválido em fevereiro (dia 30 em 2026-02 → 28)', () => {
  assert.equal(vencimentoISO('2026-02', 30), '2026-02-28')
})

// --- montarItemFatura -------------------------------------------------------
const cartaoA = { id: 'cartao-A', nome: 'Azul', dia_fechamento: 15, dia_vencimento: 10 }
const cartaoB = { id: 'cartao-B', nome: 'Black', dia_fechamento: 15, dia_vencimento: 28 }

verificar('F4 — item de fatura REAL (com valor em v_faturas) + previstos somados', () => {
  const item = montarItemFatura({
    cartao: cartaoA,
    mes: '2026-03',
    faturaReal: { cartao_id: 'cartao-A', mes_fatura: '2026-03', valor_restante: 1500.5 },
    valorPrevisto: 200,
  })
  assert.equal(item.fatura, true)
  assert.equal(item.tipo, 'real')
  assert.equal(item.id, 'fatura:cartao-A:2026-03')
  assert.equal(item.descricao, 'Fatura cartão Azul')
  assert.equal(item.data_prevista, '2026-03-10')
  assert.equal(item.valor_real, 1500.5)
  assert.equal(item.valor_previsto, 200)
  assert.equal(item.valor, 1700.5) // real + previsto
  assert.equal(item.tipo_op, 'Saida')
  assert.equal(item.estado, 'previsto')
})

verificar('F5 — item PROJETADO (sem dado real, só previstos)', () => {
  const item = montarItemFatura({
    cartao: cartaoB,
    mes: '2026-06',
    faturaReal: null,
    valorPrevisto: 800,
  })
  assert.equal(item.fatura, true)
  assert.equal(item.tipo, 'projetada')
  assert.equal(item.descricao, 'Projeção fatura cartão Black')
  assert.equal(item.valor_real, 0)
  assert.equal(item.valor_previsto, 800)
  assert.equal(item.valor, 800)
})

verificar('F6 — fatura vazia (sem real e sem previsto) não vira item', () => {
  const item = montarItemFatura({
    cartao: cartaoB,
    mes: '2026-03',
    faturaReal: null,
    valorPrevisto: 0,
  })
  assert.equal(item, null)
})

// --- montarItensFatura -------------------------------------------------------
verificar('F7 — filtra pelo vencimento dentro do range (uma por cartao/mes)', () => {
  const itens = montarItensFatura({
    faturasReais: [
      { cartao: cartaoA, mes: '2026-03', valor_restante: 100 },
      { cartao: cartaoB, mes: '2026-06', valor_restante: 200 },
    ],
    previstosPorCartaoMes: {},
    inicioISO: '2026-03-01',
    fimISO: '2026-03-31',
  })
  assert.equal(itens.length, 1)
  assert.equal(itens[0].fatura_cartao_id, 'cartao-A')
  assert.equal(itens[0].fatura_mes, '2026-03')
})

verificar('F8 — múltiplos cartões geram itens próprios na sua data', () => {
  const itens = montarItensFatura({
    faturasReais: [
      { cartao: cartaoA, mes: '2026-05', valor_restante: 100 },
      { cartao: cartaoB, mes: '2026-05', valor_restante: 200 },
    ],
    previstosPorCartaoMes: {},
    inicioISO: '2026-05-01',
    fimISO: '2026-05-31',
  })
  assert.equal(itens.length, 2)
  const nomes = itens.map((i) => i.descricao).sort()
  assert.deepEqual(nomes, ['Fatura cartão Azul', 'Fatura cartão Black'])
})

verificar('F9 — mes com só previsto gera projeção (mesmo sem fatura real)', () => {
  const itens = montarItensFatura({
    faturasReais: [],
    previstosPorCartaoMes: { 'cartao-A': { '2026-07': 500 } },
    cartoes: [cartaoA],
    inicioISO: '2026-07-01',
    fimISO: '2026-07-31',
  })
  assert.equal(itens.length, 1)
  assert.equal(itens[0].tipo, 'projetada')
  assert.equal(itens[0].valor, 500)
})

verificar('F10 — retorna vazio sem dado real nem previsto', () => {
  assert.deepEqual(
    montarItensFatura({ faturasReais: [], previstosPorCartaoMes: {}, inicioISO: null, fimISO: null }),
    [],
  )
})

console.log(`\n${ok} ok, ${falhou} falharam`)
process.exit(falhou === 0 ? 0 : 1)
