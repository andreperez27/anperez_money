// ============================================================================
// Testes do vencimento em DIA ÚTIL (src/lib/diaUtil.js)
// ============================================================================
// Execução (mesma convenção dos demais scripts):
//   node scripts/teste_diaUtil.mjs
//
// Regra (decisão 08/09/2026): o vencimento real da fatura de cartão pula fim
// de semana E feriado — se o dia fixo cai em sábado/domingo/feriado, avança
// pro próximo dia útil. A lista de feriados é a do Ponto (ponto_feriados),
// reutilizada via ehFeriado (pontoCalc) — aqui só a função pura.
import assert from 'node:assert/strict'
import { ajustarParaDiaUtil, ehDiaUtil, vencimentoRealISO } from '../src/lib/diaUtil.js'

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

// --- ehDiaUtil --------------------------------------------------------------
verificar('D1 — segunda a sexta fora de feriado são dias úteis', () => {
  // 10/09/2026 quinta.
  assert.equal(ehDiaUtil('2026-09-10'), true)
  assert.equal(ehDiaUtil('2026-09-14'), true) // segunda
})
verificar('D2 — sábado e domingo NÃO são dias úteis', () => {
  assert.equal(ehDiaUtil('2026-09-12'), false) // sábado
  assert.equal(ehDiaUtil('2026-09-13'), false) // domingo
})
verificar('D3 — feriado em dia útil NÃO é dia útil', () => {
  assert.equal(ehDiaUtil('2026-09-07', ['2026-09-07']), false) // segunda feriado
  assert.equal(ehDiaUtil('2026-09-08', ['2026-09-07']), true) // terça normal
})

// --- ajustarParaDiaUtil -----------------------------------------------------
verificar('A1 — sábado avança pra segunda seguinte', () => {
  assert.equal(ajustarParaDiaUtil('2026-09-12'), '2026-09-14')
})
verificar('A2 — domingo avança pra segunda seguinte', () => {
  assert.equal(ajustarParaDiaUtil('2026-05-31'), '2026-06-01')
})
verificar('A3 — dia útil normal não é alterado', () => {
  assert.equal(ajustarParaDiaUtil('2026-09-10'), '2026-09-10')
})
verificar('A4 — feriado em dia útil pula pro dia seguinte', () => {
  assert.equal(ajustarParaDiaUtil('2026-09-07', ['2026-09-07']), '2026-09-08')
})
verificar('A5 — feriado seguido de fim de semana pula os dois', () => {
  // 11/09/2026 sexta feriado → 12 sáb, 13 dom → 14/09 segunda.
  assert.equal(ajustarParaDiaUtil('2026-09-11', ['2026-09-11']), '2026-09-14')
})

// --- vencimentoRealISO (dia fixo do cartão + mês da fatura) -----------------
verificar('V1 — caso real: Nu PJ vence dia 12 em 09/2026 (sábado) → 14/09/2026', () => {
  assert.equal(vencimentoRealISO('2026-09', 12), '2026-09-14')
})
verificar('V2 — dia útil normal mantém a data (10/03/2026 terça)', () => {
  assert.equal(vencimentoRealISO('2026-03', 10), '2026-03-10')
})
verificar('V3 — dia fixo 31 em mês de 30 dias clampado (30/04/2026 quinta, sem mudança)', () => {
  assert.equal(vencimentoRealISO('2026-04', 31), '2026-04-30')
})
verificar('V4 — clamp de fevereiro com vencimento em sábado vira 02/03', () => {
  assert.equal(vencimentoRealISO('2026-02', 30), '2026-03-02')
})
verificar('V5 — feriado no dia fixo em mês válido pula (07/09/2026 → 08/09)', () => {
  assert.equal(vencimentoRealISO('2026-09', 7, ['2026-09-07']), '2026-09-08')
})
verificar('V6 — feriados em string e em {data} são aceitos (mesma convenção do Ponto)', () => {
  assert.equal(vencimentoRealISO('2026-09', 7, [{ data: '2026-09-07' }]), '2026-09-08')
})

console.log(`\n${ok} ok, ${falhou} falharam`)
process.exit(falhou === 0 ? 0 : 1)