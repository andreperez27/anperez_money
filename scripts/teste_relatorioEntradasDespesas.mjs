// ============================================================================
// Testes da lib "Entradas x despesas" (src/lib/relatorioEntradasDespesas.js)
// ============================================================================
// Execução (mesma convenção dos demais scripts do projeto):
//   node scripts/teste_relatorioEntradasDespesas.mjs
//
// Cobertura exigida:
//   • entradas = movimentações 'Entrada' com a quebra salario/acordo/outros
//     (origens vêm do mapa { id → origem } dos planejamentos via lancamento_id;
//     o resto vira salario — decisão 07/09/2026);
//   • despesas = tipo_op 'Saida' realizadas;
//   • transferências INTERNAS fora da conta: transferencia_id preenchido,
//     categoria transferencia/caixinha ou descrição 'entre contas';
//   • filtro defensivo: valor <= 0 ou sem tipo fora da conta;
//   • mês com só despesa; mês vazio → zeros e séries vazias;
//   • totalEntradas == soma manual (e == soma dos porMes);
//   • porMes agrega o MÊS CIVIL, porData o DIA; ordens cronológicas;
//   • lancamentos = UMA linha por lançamento (entrada OU despesa), com tipo e
//     categoria; entrada verde / despesa vermelha é decisão da view;
//   • personalizado com faixa não alinhada; erros de contrato (sem periodo,
//     faixa invertida).
// Sem dependências externas — apenas node:assert.
import assert from 'node:assert/strict'
import { definirPeriodo, definirPeriodoPersonalizado } from '../src/lib/periodos.js'
import { calcularEntradasDespesas, granularidadeDoFluxoDeCaixa } from '../src/lib/relatorioEntradasDespesas.js'

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

function mov(dataISO, valor, tipoOp, extras = {}) {
  return {
    data: dataISO,
    tipo_op: tipoOp,
    valor,
    descricao: `lançamento ${dataISO}`,
    ...extras,
  }
}

// ============================================================================
// 1) Mês com as TRÊS categorias de entrada + despesa (o caso central)
// ============================================================================
caso('entradas das três categorias + despesa somam e quebram certo', () => {
  const periodo = definirPeriodo('mes', '2026-03-15')
  const movimentacoes = [
    mov('2026-03-02', 1650, 'Entrada', { id: 'm-1' }), // salario (sem origem)
    mov('2026-03-02', 400, 'Entrada', { id: 'm-2' }), // salario (sem origem)
    mov('2026-03-10', 2000, 'Entrada', { id: 'm-3' }), // acordo
    mov('2026-03-20', 700.89, 'Entrada', { id: 'm-4' }), // outros
    mov('2026-03-15', 250, 'Saida', { id: 'm-5' }), // despesa
    mov('2026-03-16', 99.9, 'Saida', { id: 'm-6' }), // despesa
  ]
  const origens = {
    'm-3': 'historico_acordo',
    'm-4': 'historico_outros',
  }
  const r = calcularEntradasDespesas({ movimentacoes, origens, periodo })

  // Soma manual: entradas 1650 + 400 + 2000 + 700.89 = 4750.89
  //                despesas 250 + 99.9 = 349.9
  assert.equal(r.totalEntradas, 4750.89)
  assert.equal(r.totalDespesas, 349.9)
  assert.equal(r.saldo, 4400.99)
  // Soma dos porMes == totais (redundância de conferência)
  assert.equal(
    r.porMes.reduce((a, m) => a + m.entradas, 0),
    r.totalEntradas,
  )
  assert.equal(
    r.porMes.reduce((a, m) => a + m.despesas, 0),
    r.totalDespesas,
  )

  const unico = r.porMes[0]
  assert.deepEqual(unico.categorias, { salario: 2050, acordo: 2000, outros: 700.89 })
  assert.equal(unico.entradas, 4750.89)
  assert.equal(unico.despesas, 349.9)
  assert.equal(unico.saldo, 4400.99)

  // Lista: UMA linha por lançamento, entrada antes de despesa no mesmo dia.
  assert.deepEqual(
    r.lancamentos.map((l) => [l.data, l.tipo, l.valor, l.categoria]),
    [
      ['2026-03-02', 'entrada', 1650, 'salario'],
      ['2026-03-02', 'entrada', 400, 'salario'],
      ['2026-03-10', 'entrada', 2000, 'acordo'],
      ['2026-03-15', 'despesa', 250, null],
      ['2026-03-16', 'despesa', 99.9, null],
      ['2026-03-20', 'entrada', 700.89, 'outros'],
    ],
  )
})

// ============================================================================
// 2) Entradas sem origem conhecida viram salario (movimentações comuns)
// ============================================================================
caso('movimentações sem origem conhecida entram como salario', () => {
  const periodo = definirPeriodo('mes', '2026-08-15')
  const movimentacoes = [
    mov('2026-08-03', 1650, 'Entrada', { categoria: 'Importado' }),
    mov('2026-08-10', 100, 'Entrada', { categoria: 'Manual' }),
    mov('2026-08-17', 200, 'Entrada', { categoria: 'Importado' }),
    mov('2026-08-24', 50, 'Entrada', { categoria: null }),
    mov('2026-08-31', 300, 'Entrada', { categoria: 'Importado' }),
  ]
  const origens = {
    // A última linha é do acordo, mas o id do mapa NÃO bate com nenhuma movimentação
    [movimentacoes[4].id ?? 'nao-existe']: 'historico_acordo',
  }
  const r = calcularEntradasDespesas({ movimentacoes, origens, periodo })

  assert.equal(r.totalEntradas, 2300)
  const unico = r.porMes[0]
  assert.deepEqual(unico.categorias, { salario: 2300, acordo: 0, outros: 0 })
})

// ============================================================================
// 3) Transferências internas fora do fluxo (transferida / caixinha / contas)
// ============================================================================
caso('transferência interna é excluída do fluxo (todos os marcadores)', () => {
  const periodo = definirPeriodo('mes', '2026-01-15')
  const movimentacoes = [
    mov('2026-01-03', 1000, 'Entrada'), // conta — vale
    mov('2026-01-05', 300, 'Saida', { transferencia_id: 'uuid-transferencia' }), // transferência do app
    mov('2026-01-07', 250, 'Saida', { categoria: 'transferencia' }), // transferência antiga
    mov('2026-01-09', 120, 'Saida', { categoria: 'Transferência' }), // com acento/maiúscula
    mov('2026-01-11', 80, 'Saida', { categoria: 'caixinha' }), // guardar/resgatar caixinha
    mov('2026-01-13', 60, 'Entrada', { categoria: 'Importado', descricao: 'Tranferencia entre contas' }), // histórico
    mov('2026-01-15', 150, 'Saida'), // despesa — conta
  ]
  const r = calcularEntradasDespesas({ movimentacoes, periodo })

  assert.equal(r.totalEntradas, 1000)
  assert.equal(r.totalDespesas, 150)
  assert.equal(r.lancamentos.length, 2)
})

// ============================================================================
// 4) Mês só com despesa — quebra de categorias zerada nos salário/acordo
// ============================================================================
caso('mês só com despesa: entradas 0, despesas contam, categorias zeram', () => {
  const periodo = definirPeriodo('mes', '2026-02-15')
  const movimentacoes = [
    mov('2026-02-03', 999.99, 'Saida'),
    mov('2026-02-10', 1.01, 'Saida'),
  ]
  const r = calcularEntradasDespesas({ movimentacoes, periodo })

  assert.equal(r.totalEntradas, 0)
  assert.equal(r.totalDespesas, 1001)
  assert.equal(r.saldo, -1001)
  const unico = r.porMes[0]
  assert.deepEqual(unico.categorias, { salario: 0, acordo: 0, outros: 0 })
  assert.equal(r.lancamentos.length, 2)
})

// ============================================================================
// 5) Período vazio → zeros e séries vazias (estado vazio do template)
// ============================================================================
caso('vazio: nenhum dado devolve zeros e séries vazias', () => {
  const periodo = definirPeriodo('mes', '2026-01-15')
  const r = calcularEntradasDespesas({ movimentacoes: [], periodo })

  assert.equal(r.totalEntradas, 0)
  assert.equal(r.totalDespesas, 0)
  assert.equal(r.saldo, 0)
  assert.deepEqual(r.porMes, [])
  assert.deepEqual(r.porData, [])
  assert.deepEqual(r.lancamentos, [])
})

// ============================================================================
// 6) Filtro defensivo: valor/tipo fora da conta
// ============================================================================
caso('valor<=0/sem tipo ficam fora', () => {
  const periodo = definirPeriodo('mes', '2026-01-15')
  const movimentacoes = [
    mov('2026-01-05', 1000, 'Entrada'), // vale
    mov('2026-01-12', 0, 'Entrada'),
    mov('2026-01-19', -10, 'Entrada'),
    mov('2026-01-26', 200, null), // sem tipo_op
  ]
  const r = calcularEntradasDespesas({ movimentacoes, periodo })

  assert.equal(r.totalEntradas, 1000)
  assert.equal(r.lancamentos.length, 1)
})

// ============================================================================
// 7) Agregação por MÊS civil, ordem cronológica (dois meses)
// ============================================================================
caso('porMes agrega o mês civil do lançamento em ordem cronológica', () => {
  const periodo = definirPeriodo('trimestre', '2026-04-15')
  const movimentacoes = [
    mov('2026-04-10', 1650, 'Entrada'),
    mov('2026-05-20', 250, 'Saida'),
    mov('2026-06-30', 2000, 'Entrada'),
  ]
  const r = calcularEntradasDespesas({ movimentacoes, periodo })

  assert.deepEqual(
    r.porMes.map((m) => m.mes),
    ['2026-04', '2026-05', '2026-06'],
  )
  assert.deepEqual(r.porMes.map((m) => m.entradas), [1650, 0, 2000])
  assert.deepEqual(r.porMes.map((m) => m.despesas), [0, 250, 0])
  assert.deepEqual(r.porMes.map((m) => m.saldo), [1650, -250, 2000])
})

// ============================================================================
// 8) Agregação por DIA (série da visão Mês)
// ============================================================================
caso('porData agrega o dia do lançamento em ordem cronológica', () => {
  const periodo = definirPeriodo('mes', '2026-01-15')
  const movimentacoes = [
    mov('2026-01-05', 2000, 'Entrada'),
    mov('2026-01-05', 300, 'Saida'), // mesmo dia soma separado
    mov('2026-01-12', 500, 'Entrada'),
  ]
  const r = calcularEntradasDespesas({ movimentacoes, periodo })

  assert.deepEqual(
    r.porData.map((d) => d.data),
    ['2026-01-05', '2026-01-12'],
  )
  assert.deepEqual(r.porData.map((d) => d.entradas), [2000, 500])
  assert.deepEqual(r.porData.map((d) => d.despesas), [300, 0])
})

// ============================================================================
// 9) Período personalizado com faixa não alinhada a mês completo
// ============================================================================
caso('personalizado: soma apenas o que cai na faixa, por mês', () => {
  const periodo = definirPeriodoPersonalizado('2026-01-20', '2026-02-10')
  const movimentacoes = [
    mov('2026-01-15', 1000, 'Entrada'), // ANTES → fora
    mov('2026-01-25', 2000, 'Entrada'),
    mov('2026-02-05', 500, 'Saida'),
    mov('2026-02-15', 3000, 'Entrada'), // DEPOIS → fora
  ]
  const r = calcularEntradasDespesas({ movimentacoes, periodo })

  assert.equal(r.totalEntradas, 2000)
  assert.equal(r.totalDespesas, 500)
  assert.deepEqual(
    r.porMes.map((m) => m.mes),
    ['2026-01', '2026-02'],
  )
  assert.deepEqual(r.porMes.map((m) => m.entradas), [2000, 0])
  assert.deepEqual(r.porMes.map((m) => m.despesas), [0, 500])
})

// ============================================================================
// 10) Erros de contrato
// ============================================================================
caso('sem periodo lança erro claro', () => {
  assert.throws(
    () => calcularEntradasDespesas({ movimentacoes: [] }),
    /calcularEntradasDespesas espera um periodo/,
  )
})

caso('faixa invertida lança erro claro', () => {
  const periodo = { tipo: 'personalizado', inicio: '2026-03-01', fim: '2026-02-01' }
  assert.throws(
    () => calcularEntradasDespesas({ movimentacoes: [], periodo }),
    /período|faixa|invertida|inválida/i,
  )
})

// ============================================================================
// 11) Granularidade do gráfico: Mês → por SEMANA; demais períodos → por MÊS
// ============================================================================
caso('granularidade: Mês abre por Semana; demais periódicos por Mês', () => {
  assert.equal(granularidadeDoFluxoDeCaixa('mes'), 'semana')
  assert.equal(granularidadeDoFluxoDeCaixa('trimestre'), 'mes')
  assert.equal(granularidadeDoFluxoDeCaixa('semestre'), 'mes')
  assert.equal(granularidadeDoFluxoDeCaixa('ano'), 'mes')
  assert.equal(granularidadeDoFluxoDeCaixa('personalizado'), 'mes')
})

caso('mês: porSemana agrega os lançamentos por segunda-feira ISO', () => {
  const periodo = definirPeriodo('mes', '2026-03-15')
  const movimentacoes = [
    mov('2026-03-02', 1650, 'Entrada'), // W10 (02/03)
    mov('2026-03-05', 250, 'Saida'), // W10 (02/03)
    mov('2026-03-10', 2000, 'Entrada'), // W11 (09/03)
    mov('2026-03-31', 99.9, 'Saida'), // W14 (30/03)
  ]
  const r = calcularEntradasDespesas({ movimentacoes, periodo })

  assert.deepEqual(
    r.porSemana.map((s) => s.semana),
    ['2026-03-02', '2026-03-09', '2026-03-30'],
  )
  assert.deepEqual(r.porSemana.map((s) => s.entradas), [1650, 2000, 0])
  assert.deepEqual(r.porSemana.map((s) => s.despesas), [250, 0, 99.9])
})

console.log(`\n${passou} testes passaram, ${falhou} falharam.`)
if (falhou > 0) process.exit(1)