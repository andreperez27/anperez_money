import assert from 'node:assert/strict'
import { calcularRendaComprometida } from '../src/lib/planejamentoCalc.js'

// Testes da função pura "percentual de renda comprometida" (card da Visão
// Geral do Planejamento). Mesmo padrão das demais suítes: node direto,
// contador passou/falhou, exit code reflete o resultado.

let passou = 0
let falhou = 0

function caso(nome, fn) {
  try {
    fn()
    console.log(`ok      — ${nome}`)
    passou += 1
  } catch (err) {
    console.log(`FALHOU  — ${nome}: ${err.message}`)
    falhou += 1
  }
}

// Fábrica de itens com somente o que a função usa.
function item(tipo_op, valor, opts = {}) {
  return {
    tipo_op,
    valor,
    estado: opts.estado || 'previsto',
    origem: opts.origem ?? null,
    serie_id: opts.serie_id ?? null,
    data_prevista: opts.data ?? null,
  }
}

const HOJE = '2026-09-14'
const SETEMBRO_INI = '2026-09-01'
const SETEMBRO_FIM = '2026-09-30'

caso('TESTE 1 — mês FECHADO com variável: tudo que foi realizado entra', () => {
  const res = calcularRendaComprometida({
    hojeISO: HOJE,
    fimISO: '2026-08-31',
    itens: [
      item('Entrada', 5000, { estado: 'realizado' }),
      item('Entrada', 2000), // previsto não conta como renda no fechado
      item('Saida', 3000, { estado: 'realizado', origem: 'manual' }), // avulsa realizada entra
      item('Saida', 500, { estado: 'realizado', origem: 'recorrente' }),
      item('Saida', 100, { origem: 'recorrente' }), // previsto não conta no fechado
      item('Saida', 400, { estado: 'cancelado' }),
    ],
  })
  assert.strictEqual(res.modo, 'fechado')
  assert.strictEqual(res.rendaBase, 5000)
  assert.strictEqual(res.comprometidoBase, 3500)
  assert.strictEqual(res.percentual, 70)
})

caso('TESTE 2 — período ATUAL: base = saldo do dia anterior ao início + TODAS as entradas', () => {
  const res = calcularRendaComprometida({
    inicioISO: SETEMBRO_INI,
    fimISO: SETEMBRO_FIM,
    hojeISO: HOJE,
    saldoInicioPeriodo: 2500,
    itens: [
      // Realizada OU prevista, tudo soma — nenhuma estava no saldo inicial.
      item('Entrada', 6000, { estado: 'realizado', data: '2026-09-05' }),
      item('Entrada', 4000, { data: '2026-09-20' }),
      item('Entrada', 3000, { data: '2026-09-02' }),
      // Despesas: só comprometidas (recorrente/fatura/série), avulsa fora.
      item('Saida', 2000, { estado: 'realizado', origem: 'manual', data: '2026-09-03' }),
      item('Saida', 1500, { origem: 'recorrente', data: '2026-09-20' }),
      item('Saida', 800, { estado: 'realizado', serie_id: 's1', data: '2026-09-10' }),
      item('Saida', 1200, { origem: 'fatura', data: '2026-09-28' }),
      item('Saida', 300, { origem: 'manual', data: '2026-09-25' }),
    ],
  })
  assert.strictEqual(res.modo, 'atual')
  // 2500 (saldo em 31/08) + 6000 + 4000 + 3000 = 15500, sem duplicar nada.
  assert.strictEqual(res.rendaBase, 15500)
  assert.strictEqual(res.comprometidoBase, 3500)
  assert.strictEqual(res.percentual, 23) // 3500/15500 = 22,58 → 23
})

caso('TESTE 3 — renda ZERO: percentual null (sem divisão por zero)', () => {
  const res = calcularRendaComprometida({
    inicioISO: SETEMBRO_INI,
    fimISO: SETEMBRO_FIM,
    hojeISO: HOJE,
    saldoInicioPeriodo: 0,
    itens: [item('Saida', 100, { origem: 'recorrente', data: '2026-09-20' })],
  })
  assert.strictEqual(res.percentual, null)
  assert.strictEqual(res.rendaBase, 0)
})

caso('TESTE 3b — sem saldo inicial (carregando/fora da cobertura): null, sem chutar', () => {
  const res = calcularRendaComprometida({
    inicioISO: SETEMBRO_INI,
    fimISO: SETEMBRO_FIM,
    hojeISO: HOJE,
    saldoInicioPeriodo: null,
    itens: [item('Entrada', 5000, { data: '2026-09-20' })],
  })
  assert.strictEqual(res.modo, 'atual')
  assert.strictEqual(res.percentual, null)
})

caso('TESTE 4 — renda zero também no mês fechado', () => {
  const res = calcularRendaComprometida({
    hojeISO: HOJE,
    fimISO: '2026-08-31',
    itens: [item('Saida', 700, { estado: 'realizado' })],
  })
  assert.strictEqual(res.percentual, null)
  assert.strictEqual(res.modo, 'fechado')
})

caso('TESTE 5 — nenhuma despesa comprometida no período atual: 0%', () => {
  const res = calcularRendaComprometida({
    inicioISO: SETEMBRO_INI,
    fimISO: SETEMBRO_FIM,
    hojeISO: HOJE,
    saldoInicioPeriodo: 4000,
    itens: [
      item('Entrada', 1000, { data: '2026-09-20' }),
      item('Saida', 999, { origem: 'manual', data: '2026-09-25' }),
    ],
  })
  assert.strictEqual(res.percentual, 0)
  assert.strictEqual(res.comprometidoBase, 0)
  assert.strictEqual(res.rendaBase, 5000)
})

caso('TESTE 6 — fatura entra no ATUAL e não no FECHADO (sintética é previsto)', () => {
  const comFatura = [
    item('Saida', 2000, { origem: 'fatura', data: '2026-09-25' }),
    item('Saida', 1000, { estado: 'realizado', origem: 'recorrente', data: '2026-09-03' }),
  ]
  const atual = calcularRendaComprometida({
    inicioISO: SETEMBRO_INI,
    fimISO: SETEMBRO_FIM,
    hojeISO: HOJE,
    saldoInicioPeriodo: 5000,
    itens: comFatura,
  })
  assert.strictEqual(atual.modo, 'atual')
  assert.strictEqual(atual.comprometidoBase, 3000)

  const fechado = calcularRendaComprometida({ hojeISO: HOJE, fimISO: '2026-08-31', itens: comFatura })
  assert.strictEqual(fechado.modo, 'fechado')
  // No fechado só o REALIZADO conta: fatura sintética (previsto) fica de fora.
  assert.strictEqual(fechado.comprometidoBase, 1000)
})

caso('TESTE 7 — cancelado nunca participa', () => {
  const res = calcularRendaComprometida({
    inicioISO: SETEMBRO_INI,
    fimISO: SETEMBRO_FIM,
    hojeISO: HOJE,
    saldoInicioPeriodo: 10000,
    itens: [
      item('Saida', 9999, { estado: 'cancelado', origem: 'recorrente', data: '2026-09-10' }),
      item('Saida', 100, { origem: 'fatura', data: '2026-09-20' }),
    ],
  })
  assert.strictEqual(res.comprometidoBase, 100)
  assert.strictEqual(res.percentual, 1)
})

caso('TESTE 8 — lista vazia ou sem datas: percentual null', () => {
  assert.strictEqual(calcularRendaComprometida({ itens: [] }).percentual, null)
  // Sem inicio/fim o cenário cai em 'atual' com saldo real 0 e, sem entradas
  // previstas futuras nem realizadas (que já estariam no saldo), base zero.
  const indefinido = calcularRendaComprometida({
    hojeISO: HOJE,
    itens: [item('Entrada', 100, { estado: 'realizado', data: '2026-09-05' })],
  })
  assert.strictEqual(indefinido.percentual, null)
  assert.strictEqual(indefinido.modo, 'atual')
})

caso('TESTE 9 — período totalmente no FUTURO (só previstos): percentual sai', () => {
  const res = calcularRendaComprometida({
    inicioISO: '2026-10-01',
    fimISO: '2026-12-31',
    hojeISO: HOJE,
    saldoRealHoje: 99999, // saldo de hoje NÃO entra no futuro (nem começou)
    itens: [
      item('Entrada', 5000, { data: '2026-10-05' }),
      item('Saida', 1500, { origem: 'recorrente', data: '2026-10-15' }),
    ],
  })
  assert.strictEqual(res.modo, 'futuro')
  assert.strictEqual(res.rendaBase, 5000) // só entradas previstas do período
  assert.strictEqual(res.comprometidoBase, 1500)
  assert.strictEqual(res.percentual, 30)
})

caso('TESTE 10 — comprometido pode passar de 100%', () => {
  const res = calcularRendaComprometida({
    inicioISO: SETEMBRO_INI,
    fimISO: SETEMBRO_FIM,
    hojeISO: HOJE,
    saldoInicioPeriodo: 1000,
    itens: [item('Saida', 1100, { origem: 'recorrente', data: '2026-09-20' })],
  })
  assert.strictEqual(res.percentual, 110)
})

caso('TESTE 11 — cenário real 19/09 (semana 38): base com entrada realizada + saldo anterior', () => {
  // Semana 14–20/09, hoje 19/09: entrada 2400 realizada dia 16 + saída 900
  // (recorrente). Saldo no fim de 13/09 era 1500. Base = 1500 + 2400 = 3900;
  // 900/3900 = 23% (plausível — antes dava 5451% só com o saldo de hoje).
  const res = calcularRendaComprometida({
    inicioISO: '2026-09-14',
    fimISO: '2026-09-20',
    hojeISO: '2026-09-19',
    saldoInicioPeriodo: 1500,
    itens: [
      item('Entrada', 2400, { estado: 'realizado', data: '2026-09-16' }),
      item('Saida', 900, { estado: 'realizado', origem: 'recorrente', data: '2026-09-20' }),
    ],
  })
  assert.strictEqual(res.modo, 'atual')
  assert.strictEqual(res.rendaBase, 3900)
  assert.strictEqual(res.comprometidoBase, 900)
  assert.strictEqual(res.percentual, 23)
})

console.log('')
console.log(`${passou} ok, ${falhou} falharam`)
if (falhou > 0) process.exit(1)