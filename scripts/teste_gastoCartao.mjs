// ============================================================================
// Testes do "Gasto no Mês" dos cartões (src/lib/gastoCartao.js)
// ============================================================================
// Execução (mesma convenção dos demais scripts do projeto):
//   node scripts/teste_gastoCartao.mjs
//
// Cobre o comportamento definitivo do card "Gasto no Mês" (decisão 08/09/2026):
//   "Gasto no mês" = soma de compras.valor_total (valor TOTAL da compra) para
//   toda compra cuja compras.data cai no mês-alvo. NADA de parcela nem fatura.
//
// Casos-chave:
//   (a) compra de R$ 300 em 3x feita em setembro → R$ 300 INTEIROS em
//       setembro e R$ 0 em outubro/novembro (parcelas não geram valor extra);
//   (b) compra à vista soma normal no mês da data;
//   (c) compra de outro mês não aparece no mês-alvo;
//   (d) mês sem nenhuma compra → zero;
//   (e) bordas do mês: dia 01 e último dia entram; primeiro dia do mês
//       seguinte não;
//   (f) ultimoDiaDoMes/compraofDoMes (helpers usados pelo hook).
// Sem dependências externas — apenas node:assert e a lib pura.
import assert from 'node:assert/strict'
import { comprasDoMes, somarGastoDoMes, ultimoDiaDoMes } from '../src/lib/gastoCartao.js'

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

// Compra parcelada 3x R$ 300 lançada em setembro. As parcelas de outubro e
// novembro NÃO geram nada no card — o mês de referência é o da compra.
caso('parcelada: R$ 300 inteiro em setembro; R$ 0 em outubro e novembro', () => {
  const compras = [
    { id: 'c1', descricao: 'Eletrônico', data: '2026-09-10', valor_total: 300, n_parcelas: 3 },
  ]
  assert.equal(somarGastoDoMes(compras, '2026-09'), 300)
  assert.equal(somarGastoDoMes(compras, '2026-10'), 0)
  assert.equal(somarGastoDoMes(compras, '2026-11'), 0)
})

caso('vista: soma normal no mes da data', () => {
  const compras = [
    { id: 'c2', descricao: 'Mercado', data: '2026-09-03', valor_total: 164.51, n_parcelas: 1 },
    { id: 'c3', descricao: 'Farmácia', data: '2026-09-21', valor_total: 55.9, n_parcelas: 1 },
  ]
  assert.equal(somarGastoDoMes(compras, '2026-09'), 220.41)
})

caso('compra de outro mes nao aparece no mes-alvo', () => {
  const compras = [
    { id: 'c4', descricao: 'Agosto', data: '2026-08-15', valor_total: 400, n_parcelas: 1 },
    { id: 'c5', descricao: 'Outubro', data: '2026-10-02', valor_total: 77, n_parcelas: 1 },
  ]
  assert.equal(somarGastoDoMes(compras, '2026-09'), 0)
  assert.equal(somarGastoDoMes(compras, '2026-08'), 400)
  assert.equal(somarGastoDoMes(compras, '2026-10'), 77)
})

caso('mes sem nenhuma compra retorna zero (listas vazias tambem)', () => {
  assert.equal(somarGastoDoMes([], '2026-09'), 0)
  assert.equal(somarGastoDoMes(undefined, '2026-09'), 0)
  assert.equal(somarGastoDoMes(null, '2026-09'), 0)
})

caso('bordas do mes: dia 01 e ultimo dia entram; dia 01 do mes seguinte nao', () => {
  const compras = [
    { id: 'a', data: '2026-09-01', valor_total: 10, n_parcelas: 1 },
    { id: 'b', data: '2026-09-30', valor_total: 20, n_parcelas: 1 },
    { id: 'c', data: '2026-10-01', valor_total: 999, n_parcelas: 1 },
    { id: 'd', data: '2026-08-31', valor_total: 888, n_parcelas: 1 },
  ]
  assert.equal(somarGastoDoMes(compras, '2026-09'), 30)
})

caso('valor_total string numerico entra (numeric chega como number na maioria, defesa)', () => {
  const compras = [
    { data: '2026-09-05', valor_total: '150.00', n_parcelas: 1 },
    { data: '2026-09-06', valor_total: 50, n_parcelas: 1 },
  ]
  assert.equal(somarGastoDoMes(compras, '2026-09'), 200)
})

caso('defensivo: valor_total ausente, null ou nao numerico nao conta', () => {
  const compras = [
    { data: '2026-09-05', valor_total: 100, n_parcelas: 1 },
    { data: '2026-09-05', valor_total: null, n_parcelas: 1 },
    { data: '2026-09-05', n_parcelas: 1 },
    { data: '2026-09-05', valor_total: 'abc', n_parcelas: 1 },
  ]
  assert.equal(somarGastoDoMes(compras, '2026-09'), 100)
})

caso('comprasDoMes filtra a lista (breakdown usa o mesmo corte)', () => {
  const compras = [
    { id: 'x', data: '2026-09-12', valor_total: 1, n_parcelas: 1 },
    { id: 'y', data: '2026-08-30', valor_total: 999, n_parcelas: 1 },
  ]
  const setembro = comprasDoMes(compras, '2026-09')
  assert.equal(setembro.length, 1)
  assert.equal(setembro[0].id, 'x')
  assert.equal(comprasDoMes(compras, '2026-08').length, 1)
  assert.equal(comprasDoMes(undefined, '2026-09').length, 0)
})

caso('ultimoDiaDoMes: fev comum/bissexto, meses de 30/31 e invalido', () => {
  assert.equal(ultimoDiaDoMes('2026-02'), '2026-02-28')
  assert.equal(ultimoDiaDoMes('2024-02'), '2024-02-29')
  assert.equal(ultimoDiaDoMes('2026-04'), '2026-04-30')
  assert.equal(ultimoDiaDoMes('2026-09'), '2026-09-30')
  assert.equal(ultimoDiaDoMes('2026-12'), '2026-12-31')
  assert.equal(ultimoDiaDoMes('2026-13'), null)
  assert.equal(ultimoDiaDoMes('batata'), null)
})

console.log(`\n${passou} passou, ${falhou} falhou`)
if (falhou > 0) process.exit(1)