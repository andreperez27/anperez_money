// ============================================================================
// Testes da lib "Acordo trabalhista" (src/lib/relatorioAcordo.js)
// ============================================================================
// Execução (mesma convenção dos demais scripts do projeto):
//   node scripts/teste_relatorioAcordo.mjs
//
// Cobertura exigida:
//   • só entra origem='historico_acordo' (manual/jornada/recorrente/outro/
//     historico_planilha/historico_outros ficam FORA);
//   • filtro defensivo: previsto/cancelado/saída/valor<=0 fora da conta;
//   • período vazio → totais zerados e séries vazias (estado vazio do template);
//   • porMes agrega o MÊS CIVIL do recebimento, ordem cronológica;
//   • porData agrega o DIA do recebimento, ordem cronológica;
//   • porAno agrega o ANO CIVIL do recebimento com a lista de depósitos do ano;
//   • depositos = UMA linha por depósito, ordenada por data;
//   • período personalizado com faixa não alinhada a mês completo;
//   • sem periodo lança erro claro; faixa invertida lança erro claro.
// Sem dependências externas — apenas node:assert.
import assert from 'node:assert/strict'
import { definirPeriodo, definirPeriodoPersonalizado } from '../src/lib/periodos.js'
import { calcularRecebidoAcordo } from '../src/lib/relatorioAcordo.js'

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

function deposito(dataISO, valor, origem = 'historico_acordo', extras = {}) {
  return {
    tipo_op: 'Entrada',
    estado: 'realizado',
    data_prevista: dataISO,
    valor,
    origem,
    descricao: `depósito ${dataISO}`,
    ...extras,
  }
}

// ============================================================================
// 1) Só os depósitos do Acordo (origem historico_acordo) entram
// ============================================================================
caso('só origem historico_acordo conta; demais origens ficam fora', () => {
  const periodo = definirPeriodo('mes', '2026-01-15')
  const plan = [
    deposito('2026-01-05', 2000, 'historico_acordo'),
    deposito('2026-01-12', 2000, 'historico_planilha'),
    deposito('2026-01-19', 1650, 'manual'),
    deposito('2026-01-26', 4805.8, 'historico_outros'),
  ]
  const r = calcularRecebidoAcordo({ planejamentos: plan, periodo })

  assert.equal(r.totalRecebido, 2000) // só o depósito do acordo
  assert.equal(r.depositos.length, 1)
  assert.deepEqual(
    r.depositos.map((d) => d.valor),
    [2000],
  )
})

// ============================================================================
// 2) Filtro defensivo: tipo_op/estado/valor fora da conta
// ============================================================================
caso('previsto/cancelado/saída/valor<=0 ficam fora', () => {
  const periodo = definirPeriodo('mes', '2026-01-15')
  const plan = [
    deposito('2026-01-05', 2000), // vale
    { ...deposito('2026-01-12', 2000), estado: 'previsto' },
    { ...deposito('2026-01-19', 2000), estado: 'cancelado' },
    { ...deposito('2026-01-26', 2000), tipo_op: 'Saída' },
    deposito('2026-01-28', 0),
    deposito('2026-01-29', -10),
  ]
  const r = calcularRecebidoAcordo({ planejamentos: plan, periodo })

  assert.equal(r.totalRecebido, 2000)
  assert.equal(r.depositos.length, 1)
})

// ============================================================================
// 3) Período sem dados → zeros e séries vazias (estado vazio do template)
// ============================================================================
caso('vazio: nenhum dado devolve zeros e séries vazias', () => {
  const periodo = definirPeriodo('mes', '2026-01-15')
  const r = calcularRecebidoAcordo({ planejamentos: [], periodo })

  assert.equal(r.totalRecebido, 0)
  assert.deepEqual(r.depositos, [])
  assert.deepEqual(r.porMes, [])
  assert.deepEqual(r.porData, [])
})

// ============================================================================
// 4) Agregação por MÊS civil, ordem cronológica
// ============================================================================
caso('porMes agrega o mês civil do recebimento em ordem cronológica', () => {
  const periodo = definirPeriodo('trimestre', '2026-04-15')
  const plan = [
    deposito('2026-04-10', 2000),
    deposito('2026-05-20', 2000),
    deposito('2026-06-30', 500),
  ]
  const r = calcularRecebidoAcordo({ planejamentos: plan, periodo })

  assert.deepEqual(
    r.porMes.map((m) => m.mes),
    ['2026-04', '2026-05', '2026-06'],
  )
  assert.deepEqual(
    r.porMes.map((m) => m.recebido),
    [2000, 2000, 500],
  )
})

// ============================================================================
// 5) Agregação por DIA (série da visão Mês)
// ============================================================================
caso('porData agrega o dia do recebimento em ordem cronológica', () => {
  const periodo = definirPeriodo('mes', '2026-01-15')
  const plan = [
    deposito('2026-01-05', 2000),
    deposito('2026-01-05', 1000), // mesmo dia soma
    deposito('2026-01-12', 500),
  ]
  const r = calcularRecebidoAcordo({ planejamentos: plan, periodo })

  assert.deepEqual(
    r.porData.map((d) => d.data),
    ['2026-01-05', '2026-01-12'],
  )
  assert.deepEqual(
    r.porData.map((d) => d.recebido),
    [3000, 500],
  )
})

// ============================================================================
// 6) Lista detalhada: UMA linha por depósito, ordenada pela data
// ============================================================================
caso('depositos: uma linha por depósito ordenada pela data', () => {
  const periodo = definirPeriodo('mes', '2026-01-15')
  const plan = [
    deposito('2026-01-12', 500),
    deposito('2026-01-05', 2000),
    deposito('2026-01-28', 1000),
  ]
  const r = calcularRecebidoAcordo({ planejamentos: plan, periodo })

  assert.deepEqual(
    r.depositos.map((d) => [d.data, d.valor]),
    [
      ['2026-01-05', 2000],
      ['2026-01-12', 500],
      ['2026-01-28', 1000],
    ],
  )
})

// ============================================================================
// 7) Agregação por ANO CIVIL — gráfico e lista por ano da aba
// ============================================================================
caso('porAno agrupa por ano civil com o total e a lista de depósitos', () => {
  const periodo = definirPeriodoPersonalizado('2025-12-01', '2026-12-31')
  const plan = [
    deposito('2025-12-10', 2000),
    deposito('2026-01-05', 1000),
    deposito('2026-06-15', 500),
    deposito('2026-12-20', 2500),
  ]
  const r = calcularRecebidoAcordo({ planejamentos: plan, periodo })

  assert.deepEqual(
    r.porAno.map((a) => a.ano),
    ['2025', '2026'],
  )
  assert.deepEqual(
    r.porAno.map((a) => a.recebido),
    [2000, 4000],
  )
  // cada ano carrega APENAS os depósitos daquele ano, em ordem cronológica
  const ano2026 = r.porAno.find((a) => a.ano === '2026')
  assert.deepEqual(
    ano2026.depositos.map((d) => [d.data, d.valor]),
    [
      ['2026-01-05', 1000],
      ['2026-06-15', 500],
      ['2026-12-20', 2500],
    ],
  )
  assert.equal(ano2026.depositos.reduce((s, d) => s + d.valor, 0), ano2026.recebido)
})

caso('porAno vazio devolve lista vazia', () => {
  const periodo = definirPeriodo('mes', '2026-01-15')
  const r = calcularRecebidoAcordo({ planejamentos: [], periodo })
  assert.deepEqual(r.porAno, [])
})

// ============================================================================
// 8) Período personalizado com faixa não alinhada a mês completo
// ============================================================================
caso('personalizado: soma apenas o que cai na faixa, por mês', () => {
  const periodo = definirPeriodoPersonalizado('2026-01-20', '2026-02-10')
  const plan = [
    deposito('2026-01-15', 1000), // ANTES da faixa → fora
    deposito('2026-01-25', 2000), // dentro (janeiro)
    deposito('2026-02-05', 500), // dentro (fevereiro)
    deposito('2026-02-15', 3000), // DEPOIS da faixa → fora
  ]
  const r = calcularRecebidoAcordo({ planejamentos: plan, periodo })

  assert.equal(r.totalRecebido, 2500)
  assert.deepEqual(
    r.porMes.map((m) => m.mes),
    ['2026-01', '2026-02'],
  )
  assert.deepEqual(
    r.porMes.map((m) => m.recebido),
    [2000, 500],
  )
})

// ============================================================================
// 9) Erros de contrato
// ============================================================================
caso('sem periodo lança erro claro', () => {
  assert.throws(
    () => calcularRecebidoAcordo({ planejamentos: [] }),
    /calcularRecebidoAcordo espera um periodo/,
  )
})

caso('faixa invertida lança erro claro', () => {
  const periodo = { tipo: 'personalizado', inicio: '2026-03-01', fim: '2026-02-01' }
  assert.throws(
    () => calcularRecebidoAcordo({ planejamentos: [], periodo }),
    /período|faixa|invertida|inválida/i,
  )
})

console.log(`\n${passou} testes passaram, ${falhou} falharam.`)
if (falhou > 0) process.exit(1)