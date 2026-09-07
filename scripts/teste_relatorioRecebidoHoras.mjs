// ============================================================================
// Testes do relatório "Recebido & horas" (src/lib/relatorioRecebidoHoras.js)
// ============================================================================
// Execução (mesma convenção dos demais scripts do projeto):
//   node scripts/teste_relatorioRecebidoHoras.mjs
//
// Cobertura exigida:
//   • período com só histórico (entradas realizadas, SEM horas do Ponto);
//   • extras = SEMANA DE TRABALHO RECEBIDA ACIMA DO FIXO PADRÃO (regra ajustada
//     em 06/09/2026): extra da semana de trabalho W = max(0, Σ(valores dos
//     pagamentos que cobrem W) − fixoSemana). Semana paga exatamente o fixo →
//     0; semana paga acima → o excedente vira o extra da linha;
//   • semana com FERIADO: recebido 1.800 com fixo 1.650 → extra 150 (e NÃO os
//     400 brutos valorHe+valorDomfer do fechamento do Ponto — caso 06/05/2026);
//   • pagamento SEM semana de trabalho gravada (planilha, seguro, netflix...)
//     jamais ganha extra (não casa com semana);
//   • FIXO HISTÓRICO DA PLANILHA (migration 30, decisão 06/09/2026): o item
//     pode carregar `valor_semanal` (coluna B — o fixo da época). Quando TODAS
//     as parcelas da mesma semana têm, a base é a SOMA delas (junho parcelado:
//     825+825=1650) e prevalece sobre o fixoSemana da config; caso contrário
//     vale o fixoSemana (a config atual do Ponto);
//   • UMA LINHA POR PAGAMENTO REALIZADO: dois ou mais pagamentos que cobrem a
//     MESMA semana de trabalho NÃO são fundidos — cada um vira um recebimento
//     com a própria data e o próprio valor;
//   • rateio PROPORCIONAL dos extras quando vários pagamentos parcelam a mesma
//     semana: fatias na proporção do valor de cada parcela, soma EXATA em
//     centavos, e a semana conta UMA única vez nos totais;
//   • período MISTO (entradas + valor de horas no mesmo mês);
//   • período sem nenhum dado (estado vazio do template continua aparecendo);
//   • filtro defensivo: previsto/cancelado/saída/valor<=0 fora da conta;
//   • referente da linha vem das COLUNAS GRAVADAS ano_semana_trabalho/
//     semana_trabalho (migration 28) — NUNCA um cálculo de datas; semana de
//     trabalho inválida não derruba (referente vira null);
//   • período personalizado com faixa não alinhada a mês completo;
//   • regra 05/09/2026: planilha completa lacunas até a semana 34 (24/08/2026);
//     de lá em diante vale o que estiver no app (não duplica);
//   • porSemana: mês com 4 semanas completas; semana cortada (vira o mês
//     anterior/seguinte) na primeira/e última borda;
//   • porSemana SEMPRE na semana CIVIL do RECEBIMENTO (data_prevista — o dia
//     em que o dinheiro entrou), como no dashboard do app antigo e na
//     planilha; as colunas de semana TRABALHADA não mudam a barra — só o
//     referente informativo da linha (que agora vive em `recebimentos`);
//   • porData: UMA BARRA POR DATA DE RECEBIMENTO na visão Mês (bug 2 de
//     06/09/2026) — pagamentos da MESMA data somam numa barra só; a barra de
//     um dia no começo do mês NÃO some do gráfico (na grade de semana civil a
//     primeira semana cortada ficava de fora e sumia com o pagamento de 03/07);
//   • escolha porData (Mês) x porMes (Trimestre/Semestre/Ano/Personalizado).
//
// Contrato atual (lib reescrita em 06/09/2026):
//   calcularRecebidoHoras({ planejamentosRealizados, fixoSemana, periodo })
//     → { totalRecebido, totalValorHorasExtras,
//     porMes: [{ mes, recebido, valorHorasExtras }],
//     porData: [{ data, recebido, valorHorasExtras }],
//     porSemana: [{ semana, recebido, valorHorasExtras }],
//     recebimentos: [{ data, semana, valor, valorHorasExtras, referente, descricao }] }
//   • cada item de planejamentosRealizados também PODE trazer `valor_semanal`
//     (o VALOR SEMANAL da planilha — a base histórica da semana);
//   • porMes/porData = séries AGREGADAS do gráfico (porData alimenta a visão
//     Mês: uma barra por dia); porSemana é a série agregada por semana civil,
//     mantida para compatibilidade/inspeção;
//   • recebimentos = lista detalhada, UMA linha por pagamento realizado.
// Sem dependências externas — apenas node:assert.
import assert from 'node:assert/strict'
import { definirPeriodo, definirPeriodoPersonalizado } from '../src/lib/periodos.js'
import {
  agrupamentoPorTipoDePeriodo,
  calcularRecebidoHoras,
  selecionarSerieDoRelatorio,
} from '../src/lib/relatorioRecebidoHoras.js'

const FIXO = 1650 // VALORES_PADRAO_PONTO.fixoSemana / ponto_config.VALOR_FIXO_SEMANA

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

function entrada(dataISO, valor, extras = {}) {
  return {
    tipo_op: 'Entrada',
    estado: 'realizado',
    data_prevista: dataISO,
    valor,
    descricao: `entrada ${dataISO}`,
    ...extras,
  }
}

// ============================================================================
// 1) Só histórico — período sem nenhum excedente acima do fixo
// ============================================================================
caso('só histórico: trimestre com entradas e zero valor de extras', () => {
  const periodo = definirPeriodo('trimestre', '2026-04-15')
  // Cada pagamento entra na semana CIVIL em que foi recebido (data_prevista).
  // Nenhum valor passa do fixo semanal → não há excedente → extras 0.
  const plan = [
    entrada('2026-04-10', 1000),
    entrada('2026-05-20', 1650),
    entrada('2026-06-30', 500),
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  assert.equal(r.totalRecebido, 3150)
  assert.equal(r.totalValorHorasExtras, 0)
  assert.deepEqual(
    r.porMes.map((m) => m.mes),
    ['2026-04', '2026-05', '2026-06'],
  )
  assert.deepEqual(
    r.porMes.map((m) => m.recebido),
    [1000, 1650, 500],
  )
  assert.deepEqual(
    r.porMes.map((m) => m.valorHorasExtras),
    [0, 0, 0],
  )
  assert.deepEqual(
    r.porSemana.map((s) => s.semana),
    ['2026-04-06', '2026-05-18', '2026-06-29'],
  )
  assert.deepEqual(
    r.porSemana.map((s) => s.recebido),
    [1000, 1650, 500],
  )
  // recebimentos: UMA linha por pagamento; sem colunas de trabalho gravadas →
  // referente fica null (nada de "menos 7 dias" a partir da data).
  assert.deepEqual(
    r.recebimentos.map((i) => [i.data, i.valor, i.referente]),
    [
      ['2026-04-10', 1000, null],
      ['2026-05-20', 1650, null],
      ['2026-06-30', 500, null],
    ],
  )
  assert.deepEqual(
    r.recebimentos.map((i) => i.descricao),
    ['entrada 2026-04-10', 'entrada 2026-05-20', 'entrada 2026-06-30'],
  )
})

// ============================================================================
// 2) Sem recebimento cobrindo semana → nada de extras
// ============================================================================
caso('sem recebimento cobrindo: extras não geram linha (são parte do recebido)', () => {
  const periodo = definirPeriodo('mes', '2026-08-15')
  const r = calcularRecebidoHoras({ planejamentosRealizados: [], fixoSemana: FIXO, periodo })

  // Nenhum recebimento no período → nada entra.
  assert.equal(r.totalRecebido, 0)
  assert.equal(r.totalValorHorasExtras, 0)
  assert.deepEqual(r.porMes, [])
  assert.deepEqual(r.porSemana, [])
  assert.deepEqual(r.recebimentos, [])
})

// ============================================================================
// 2b) Semana paga ACIMA do fixo → o excedente vira o extra da linha
// ============================================================================
caso('semana paga acima do fixo: o excedente (acima de 1.650) vira o extra', () => {
  const periodo = definirPeriodo('mes', '2026-05-10')
  // 05/11 paga 1.850 → extra 200; 05/18 paga 2.050 → extra 400; 05/25 paga
  // 2.130 → extra 480. Cada um na linha do próprio recebimento.
  const plan = [
    entrada('2026-05-11', 1850, { ano_semana_trabalho: 2026, semana_trabalho: 19 }),
    entrada('2026-05-18', 2050, { ano_semana_trabalho: 2026, semana_trabalho: 20 }),
    entrada('2026-05-25', 2130, { ano_semana_trabalho: 2026, semana_trabalho: 21 }),
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  assert.equal(r.totalRecebido, 6030)
  assert.equal(r.totalValorHorasExtras, 1080) // 200 + 400 + 480
  assert.deepEqual(r.porMes, [{ mes: '2026-05', recebido: 6030, valorHorasExtras: 1080 }])
  assert.deepEqual(
    r.porSemana.map((s) => s.semana),
    ['2026-05-11', '2026-05-18', '2026-05-25'],
  )
  assert.deepEqual(
    r.porSemana.map((s) => s.valorHorasExtras),
    [200, 400, 480],
  )
  assert.deepEqual(
    r.recebimentos.map((i) => [i.data, i.valorHorasExtras]),
    [
      ['2026-05-11', 200],
      ['2026-05-18', 400],
      ['2026-05-25', 480],
    ],
  )
})

// ============================================================================
// 3) Misto — entradas e horas (em valor) no mesmo período
// ============================================================================
caso('misto: entradas e valor de extras somam lado a lado', () => {
  const periodo = definirPeriodo('mes', '2026-07-10')
  const plan = [
    entrada('2026-07-07', 1790, { ano_semana_trabalho: 2026, semana_trabalho: 28 }), // extra 140
    entrada('2026-07-14', 1690, { ano_semana_trabalho: 2026, semana_trabalho: 29 }), // extra 40
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  assert.equal(r.totalRecebido, 3480)
  assert.equal(r.totalValorHorasExtras, 180)
  assert.deepEqual(r.porMes, [{ mes: '2026-07', recebido: 3480, valorHorasExtras: 180 }])
  assert.deepEqual(r.porSemana, [
    { semana: '2026-07-06', recebido: 1790, valorHorasExtras: 140 },
    { semana: '2026-07-13', recebido: 1690, valorHorasExtras: 40 },
  ])
  assert.deepEqual(r.recebimentos, [
    {
      data: '2026-07-07',
      semana: '2026-07-06',
      valor: 1790,
      valorHorasExtras: 140,
      referente: '2026-07-06',
      descricao: 'entrada 2026-07-07',
    },
    {
      data: '2026-07-14',
      semana: '2026-07-13',
      valor: 1690,
      valorHorasExtras: 40,
      referente: '2026-07-13',
      descricao: 'entrada 2026-07-14',
    },
  ])
})

// ============================================================================
// 4) Vazio — nada no período → porMes/porSemana vazios ("Em construção")
// ============================================================================
caso('vazio: nenhum dado devolve zeros e séries vazias', () => {
  const periodo = definirPeriodo('mes', '2026-02-15')
  const r = calcularRecebidoHoras({
    planejamentosRealizados: [],
    fixoSemana: FIXO,
    periodo,
  })

  assert.equal(r.totalRecebido, 0)
  assert.equal(r.totalValorHorasExtras, 0)
  assert.deepEqual(r.porMes, [])
  assert.deepEqual(r.porSemana, [])
  assert.deepEqual(r.recebimentos, [])
})

// ============================================================================
// 5) Filtro defensivo da lib
// ============================================================================
caso('filtra previsto/cancelado/saída/valor<=0', () => {
  const periodo = definirPeriodo('mes', '2026-05-10')
  const plan = [
    entrada('2026-05-05', 1000),
    { ...entrada('2026-05-06', 2000), estado: 'previsto' },
    { ...entrada('2026-05-07', 1000), estado: 'cancelado' },
    { ...entrada('2026-05-08', 999), tipo_op: 'Saida' },
    { ...entrada('2026-05-09', 0) },
    entrada('2026-06-01', 5000), // fora do período
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  assert.equal(r.totalRecebido, 1000)
  assert.deepEqual(r.porMes, [{ mes: '2026-05', recebido: 1000, valorHorasExtras: 0 }])
  assert.deepEqual(
    r.recebimentos.map((i) => i.data),
    ['2026-05-05'],
  )
})

// ============================================================================
// 6) Extras seguem o mês/semana do RECEBIMENTO do pagamento que os cobre
// ============================================================================
caso('semana 27/07 (julho) entra na linha do pagamento 10/08 (agosto)', () => {
  const periodo = definirPeriodo('mes', '2026-08-10')
  // Pagamentos que cobrem semanas de trabalho COMECADAS em julho, recebidos
  // em agosto (coluna = trabalho). O excedente acima do fixo vira o extra.
  const plan = [
    entrada('2026-08-10', 2050, { ano_semana_trabalho: 2026, semana_trabalho: 31 }), // extra 400
    entrada('2026-08-17', 1730, { ano_semana_trabalho: 2026, semana_trabalho: 32 }), // extra 80
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  // O mês do relatório é o do RECEBIMENTO: o extra da semana 27/07 (que começa
  // em julho, 2.050 − 1.650 = 400) entra em agosto junto com o pagamento.
  assert.equal(r.totalValorHorasExtras, 480)
  assert.deepEqual(r.porMes, [{ mes: '2026-08', recebido: 3780, valorHorasExtras: 480 }])
  assert.deepEqual(
    r.porSemana.map((s) => s.semana),
    ['2026-08-10', '2026-08-17'],
  )
  assert.deepEqual(
    r.porSemana.map((s) => s.recebido),
    [2050, 1730],
  )
  assert.deepEqual(
    r.porSemana.map((s) => s.valorHorasExtras),
    [400, 80],
  )
  assert.deepEqual(
    r.recebimentos.map((i) => [i.data, i.valorHorasExtras]),
    [
      ['2026-08-10', 400],
      ['2026-08-17', 80],
    ],
  )
})

// ============================================================================
// 7) Período personalizado (faixa livre)
// ============================================================================
caso('personalizado: soma apenas o que cai na faixa, por mês', () => {
  const periodo = definirPeriodoPersonalizado('2026-03-20', '2026-04-10')
  const plan = [
    entrada('2026-03-19', 100), // antes da faixa — fora
    entrada('2026-03-25', 300), // dentro, março
    entrada('2026-04-05', 400), // dentro, abril
    entrada('2026-04-15', 900), // depois da faixa — fora
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  assert.equal(r.totalRecebido, 700)
  assert.deepEqual(
    r.porMes.map((m) => m.mes),
    ['2026-03', '2026-04'],
  )
  assert.deepEqual(
    r.porMes.map((m) => m.recebido),
    [300, 400],
  )
  assert.deepEqual(
    r.recebimentos.map((i) => i.data),
    ['2026-03-25', '2026-04-05'],
  )
})

// ============================================================================
// 8) Validações
// ============================================================================
caso('sem periodo lança erro claro', () => {
  assert.throws(() => calcularRecebidoHoras({}), /periodo/)
})

caso('faixa invertida lança erro claro', () => {
  assert.throws(
    () =>
      calcularRecebidoHoras({
        planejamentosRealizados: [],
        fixoSemana: FIXO,
        periodo: { tipo: 'personalizado', inicio: '2026-06-30', fim: '2026-06-01' },
      }),
    /depois do fim/,
  )
})

// ============================================================================
// 9) Regra 05/09/2026: a planilha completa as lacunas até a semana 34 (24/08);
//    de lá em diante vale o que estiver no app
// ============================================================================
caso('planilha conta até 23/08/2026; de 24/08 vale o app (sem duplicar)', () => {
  const periodo = definirPeriodo('mes', '2026-08-10')
  const plan = [
    // Planilha preenchendo lacunas: semanas ANTES de 24/08 entram.
    { ...entrada('2026-08-06', 2050), origem: 'historico_planilha' },
    { ...entrada('2026-08-14', 1650), origem: 'historico_planilha' },
    { ...entrada('2026-08-20', 2050), origem: 'historico_planilha' },
    // A da PLANILHA com data 26/08 (≥ corte) NÃO conta; a MANUAL do app conta.
    { ...entrada('2026-08-26', 2050), origem: 'historico_planilha' },
    entrada('2026-08-26', 2050), // app manual — recebido na semana 24/08
    // Antes do corte a planilha é a fonte (lacuna): conta (2025).
    { ...entrada('2025-08-26', 1800), origem: 'historico_planilha' },
  ]
  // Registros da planilha não têm colunas de trabalho → nada casa com semana →
  // nenhum deles ganha extra (mesmo os que passam do fixo na planilha).
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  // Em 2026-08: planilha 06+14+20 (5750) + manual 26/08 (2050) = 7800.
  assert.equal(r.totalRecebido, 7800)
  assert.equal(r.totalValorHorasExtras, 0)
  assert.deepEqual(r.porMes, [{ mes: '2026-08', recebido: 7800, valorHorasExtras: 0 }])
  // porSemana guarda cada pagamento na semana CIVIL em que entrou:
  // 06/08→03/08, 14/08→10/08, 20/08→17/08, manual 26/08→24/08.
  assert.deepEqual(
    r.porSemana.map((s) => s.semana),
    ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24'],
  )
  assert.deepEqual(
    r.porSemana.map((s) => s.recebido),
    [2050, 1650, 2050, 2050],
  )
  // Recebimentos: UMA linha por pagamento (inclui a planilha de 26/08 não? não —
  // ela é filtrada pelo corte, então ficam só as 4 que contam). Registros da
  // planilha sem colunas de trabalho: referente null; descricao carrega o texto.
  assert.deepEqual(
    r.recebimentos.map((i) => [i.data, i.valor, i.referente]),
    [
      ['2026-08-06', 2050, null],
      ['2026-08-14', 1650, null],
      ['2026-08-20', 2050, null],
      ['2026-08-26', 2050, null],
    ],
  )
})

// ============================================================================
// 10) porSemana — mês com quatro semanas completas (fevereiro/2026)
// ============================================================================
caso('porSemana: mês com 4 semanas completas quebra semana a semana', () => {
  const periodo = definirPeriodo('mes', '2026-02-15')
  // Pagamentos recebidos de 02 a 23/02; cada um guarda a semana de trabalho
  // que cobre (a anterior). Só o de 23/02 passa do fixo → extra 400.
  const plan = [
    entrada('2026-02-02', 1650, { ano_semana_trabalho: 2026, semana_trabalho: 5 }), // ref. 26/01 → 0
    entrada('2026-02-09', 1650, { ano_semana_trabalho: 2026, semana_trabalho: 6 }), // ref. 02/02 → 0
    entrada('2026-02-16', 1650, { ano_semana_trabalho: 2026, semana_trabalho: 7 }), // ref. 09/02 → 0
    entrada('2026-02-23', 2050, { ano_semana_trabalho: 2026, semana_trabalho: 8 }), // ref. 16/02 → 400
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  assert.equal(r.totalRecebido, 7000)
  assert.equal(r.totalValorHorasExtras, 400)
  assert.deepEqual(r.porMes, [{ mes: '2026-02', recebido: 7000, valorHorasExtras: 400 }])
  assert.deepEqual(
    r.porSemana.map((s) => s.semana),
    ['2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23'],
  )
  assert.deepEqual(
    r.porSemana.map((s) => s.recebido),
    [1650, 1650, 1650, 2050],
  )
  assert.deepEqual(
    r.porSemana.map((s) => s.valorHorasExtras),
    [0, 0, 0, 400],
  )
  assert.deepEqual(
    r.recebimentos.map((i) => [i.data, i.valorHorasExtras]),
    [
      ['2026-02-02', 0],
      ['2026-02-09', 0],
      ['2026-02-16', 0],
      ['2026-02-23', 400],
    ],
  )
})

// ============================================================================
// 11) porSemana — semana cortada na borda (recebimento decide o mês)
// ============================================================================
caso('porSemana: primeira semana cortada fica no mês anterior (set/2026)', () => {
  const periodo = definirPeriodo('mes', '2026-09-15')
  // Trabalho da semana 31/08 começa em AGOSTO mas é pago/recebido em 08/09:
  // a linha é a da semana do RECEBIMENTO (07/09). A última semana de
  // setembro (28/09–04/10) fica inteira no mês (não é repartida). Só o
  // pagamento de 30/09 passa do fixo (2.050 → extra 400).
  const plan = [
    entrada('2026-09-08', 1650, { ano_semana_trabalho: 2026, semana_trabalho: 36 }),
    entrada('2026-09-14', 1650, { ano_semana_trabalho: 2026, semana_trabalho: 37 }),
    entrada('2026-09-30', 2050, { ano_semana_trabalho: 2026, semana_trabalho: 40 }),
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  assert.equal(r.totalRecebido, 5350)
  assert.equal(r.totalValorHorasExtras, 400)
  assert.deepEqual(r.porMes, [{ mes: '2026-09', recebido: 5350, valorHorasExtras: 400 }])
  assert.deepEqual(
    r.porSemana.map((s) => s.semana),
    ['2026-09-07', '2026-09-14', '2026-09-28'],
  )
  assert.deepEqual(
    r.porSemana.map((s) => s.recebido),
    [1650, 1650, 2050],
  )
  assert.deepEqual(
    r.porSemana.map((s) => s.valorHorasExtras),
    [0, 0, 400],
  )
  assert.deepEqual(
    r.recebimentos.map((i) => [i.data, i.valorHorasExtras]),
    [
      ['2026-09-08', 0],
      ['2026-09-14', 0],
      ['2026-09-30', 400],
    ],
  )
})

caso('outubro: extras da semana 28/09 entram na linha do pagamento 05/10', () => {
  const periodo = definirPeriodo('mes', '2026-10-15')
  const plan = [
    // 05/10 paga 1.750 (ref 40 → semana 28/09) → extra 100; 12/10 paga 1.700
    // (ref 41 → semana 05/10) → extra 50. A última de outubro atravessa
    // novembro: o pagamento chegaria em 02/11 — fica fora (extras seguem o
    // recebimento).
    entrada('2026-10-05', 1750, { ano_semana_trabalho: 2026, semana_trabalho: 40 }),
    entrada('2026-10-12', 1700, { ano_semana_trabalho: 2026, semana_trabalho: 41 }),
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  assert.equal(r.totalRecebido, 3450)
  assert.equal(r.totalValorHorasExtras, 150) // 100 + 50
  assert.deepEqual(r.porMes, [{ mes: '2026-10', recebido: 3450, valorHorasExtras: 150 }])
  assert.deepEqual(
    r.porSemana.map((s) => s.semana),
    ['2026-10-05', '2026-10-12'],
  )
  assert.deepEqual(
    r.porSemana.map((s) => s.valorHorasExtras),
    [100, 50],
  )
  assert.deepEqual(
    r.recebimentos.map((i) => [i.data, i.valorHorasExtras]),
    [
      ['2026-10-05', 100],
      ['2026-10-12', 50],
    ],
  )
})

// ============================================================================
// 12) SEMANA DO RECEBIMENTO + referente vindo das colunas gravadas
// ============================================================================
caso('porSemana usa a semana em que o dinheiro ENTROU; recebimentos separam linhas', () => {
  const periodo = definirPeriodo('mes', '2026-08-10')
  const plan = [
    // 26/08 (quarta: semana civil 24–30/08). A reconciliação registra a
    // semana TRABALHADA 34 (17–23/08), mas a barra é 24/08 (o recebimento) e o
    // referente da linha é a 17/08 (a coluna gravada, não "menos 7 dias").
    // 2.050 − 1.650 = 400 de extra na linha; o 1.650 do mesmo dia (sem
    // colunas) → 0 (não casa com semana).
    entrada('2026-08-26', 2050, { ano_semana_trabalho: 2026, semana_trabalho: 34 }),
    entrada('2026-08-26', 1650), // mesmo dia, sem colunas → mesma barra
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  // Barra agregada soma os dois (mesma semana de recebimento)…
  assert.deepEqual(r.porSemana, [
    { semana: '2026-08-24', recebido: 3700, valorHorasExtras: 400 },
  ])
  assert.equal(r.totalRecebido, 3700)
  assert.deepEqual(r.porMes, [{ mes: '2026-08', recebido: 3700, valorHorasExtras: 400 }])
  // …mas recebimentos mantém UMA LINHA POR PAGAMENTO, cada uma com o seu
  // referente (não funde nem concatena datas).
  assert.deepEqual(r.recebimentos, [
    {
      data: '2026-08-26',
      semana: '2026-08-24',
      valor: 2050,
      valorHorasExtras: 400,
      referente: '2026-08-17',
      descricao: 'entrada 2026-08-26',
    },
    {
      data: '2026-08-26',
      semana: '2026-08-24',
      valor: 1650,
      valorHorasExtras: 0,
      referente: null,
      descricao: 'entrada 2026-08-26',
    },
  ])
})

caso('referente do exemplo do André: 06/08 → ref 27/07 a 02/08 com extras 400', () => {
  const periodo = definirPeriodo('mes', '2026-08-10')
  const plan = [entrada('2026-08-06', 2050, { ano_semana_trabalho: 2026, semana_trabalho: 31 })]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  assert.deepEqual(r.porSemana, [
    { semana: '2026-08-03', recebido: 2050, valorHorasExtras: 400 },
  ])
  assert.deepEqual(r.recebimentos[0], {
    data: '2026-08-06',
    semana: '2026-08-03',
    valor: 2050,
    valorHorasExtras: 400,
    referente: '2026-07-27',
    descricao: 'entrada 2026-08-06',
  })
})

caso('semana de trabalho inválida não derruba (referente null, bucket pelo recebimento)', () => {
  const periodo = definirPeriodo('mes', '2026-08-10')
  const plan = [
    // semana 55 não existe em ano ISO → não quebra: o bucket continua sendo a
    // semana civil do recebimento (24/08) e o referente fica null.
    entrada('2026-08-26', 1000, { ano_semana_trabalho: 2026, semana_trabalho: 55 }),
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  assert.deepEqual(r.porSemana, [
    { semana: '2026-08-24', recebido: 1000, valorHorasExtras: 0 },
  ])
  assert.deepEqual(r.recebimentos, [
    {
      data: '2026-08-26',
      semana: '2026-08-24',
      valor: 1000,
      valorHorasExtras: 0,
      referente: null,
      descricao: 'entrada 2026-08-26',
    },
  ])
})

caso('pagamento de 02/09 entra na semana 31/08 com extras 480; 26/08 fica na 24/08', () => {
  // Cenário real da divergência: o recebido da semana 24–30/08 é o 2.050 do
  // dia 26/08 (referente 17–23/08 → extra 400); o pagamento referente à
  // semana 24–30/08 (2.130, valor fixo 1.650 + extras 480) só entra no dia
  // 02/09 — semana 31/08, e é aquele que carrega os extras 480.
  const periodo = definirPeriodoPersonalizado('2026-08-17', '2026-09-06')
  const plan = [
    entrada('2026-08-26', 2050, { ano_semana_trabalho: 2026, semana_trabalho: 34 }),
    entrada('2026-09-02', 2130, { ano_semana_trabalho: 2026, semana_trabalho: 35 }),
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  assert.equal(r.totalRecebido, 4180)
  assert.equal(r.totalValorHorasExtras, 880) // 400 (26/08) + 480 (02/09)
  assert.deepEqual(r.porSemana, [
    { semana: '2026-08-24', recebido: 2050, valorHorasExtras: 400 },
    { semana: '2026-08-31', recebido: 2130, valorHorasExtras: 480 },
  ])
  assert.deepEqual(
    r.recebimentos.map((i) => [i.data, i.referente, i.valorHorasExtras]),
    [
      ['2026-08-26', '2026-08-17', 400],
      ['2026-09-02', '2026-08-24', 480],
    ],
  )
})

// ============================================================================
// 13) NÃO FUSÃO + RATEIO PROPORCIONAL (regra 06/09/2026 — caso real de junho)
// ============================================================================
caso('junho/2026: duas parcelas de 50% cobrindo a mesma semana viram linhas separadas', () => {
  // Cenário real (planilha corrigida): semana de trabalho 01/06 paga em DUAS
  // parcelas de 1.025 (12/06 e 25/06). Juntas cobrem a semana: soma 2.050 →
  // extra = 2050 − 1650 = 400 (Corpus Christi, 04/06). Cada parcela leva 200
  // (rateio 50/50). ANTIGAMENTE as linhas 25/06 e 26/06 se fundiam (mesma
  // semana civil de recebimento) — agora cada pagamento é sua linha.
  const periodo = definirPeriodo('mes', '2026-06-15')
  const plan = [
    entrada('2026-06-03', 1650, { ano_semana_trabalho: 2026, semana_trabalho: 22 }), // ref 25/05 → 0
    entrada('2026-06-12', 1025, { ano_semana_trabalho: 2026, semana_trabalho: 23 }), // ref 01/06 (50%)
    entrada('2026-06-25', 1025, { ano_semana_trabalho: 2026, semana_trabalho: 23 }), // ref 01/06 (50%)
    entrada('2026-06-26', 1650, { ano_semana_trabalho: 2026, semana_trabalho: 24 }), // ref 08/06 → 0
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  assert.equal(r.totalRecebido, 5350)
  // A semana 01/06 conta UMA única vez (400), nunca duplica.
  assert.equal(r.totalValorHorasExtras, 400)
  assert.deepEqual(r.porMes, [{ mes: '2026-06', recebido: 5350, valorHorasExtras: 400 }])

  // UMA LINHA POR PAGAMENTO — 4 linhas, datas distintas, sem concatenar.
  assert.equal(r.recebimentos.length, 4)
  assert.deepEqual(
    r.recebimentos.map((i) => terna(i)),
    [
      ['2026-06-03', 1650, 0],
      ['2026-06-12', 1025, 200], // 50% do excedente 400
      ['2026-06-25', 1025, 200], // 50% do excedente 400
      ['2026-06-26', 1650, 0],
    ],
  )
  // A barra por semana civil segue somando o que entrou em cada semana; as
  // fatias das linhas acompanham a semana de RECEBIMENTO de cada uma.
  assert.deepEqual(
    r.porSemana.map((s) => [s.semana, s.recebido, s.valorHorasExtras]),
    [
      ['2026-06-01', 1650, 0], //  03/06
      ['2026-06-08', 1025, 200], // 12/06
      ['2026-06-22', 2675, 200], // 25/06 + 26/06 (soma, sem fundir as linhas)
    ],
  )
})

function terna(item) {
  return [item.data, item.valor, item.valorHorasExtras]
}

caso('rateio proporcional 75/25: fatias 262,50/87,50 do excedente 350', () => {
  // Dois pagamentos pela mesma semana: 1.500 + 500 = 2.000 → excedente
  // 2000 − 1650 = 350. Fatias proporcionais: 350×1500/2000 = 262,50 e
  // 350×500/2000 = 87,50 (soma exata 350).
  const periodo = definirPeriodo('mes', '2026-06-15')
  const plan = [
    entrada('2026-06-12', 1500, { ano_semana_trabalho: 2026, semana_trabalho: 23 }),
    entrada('2026-06-25', 500, { ano_semana_trabalho: 2026, semana_trabalho: 23 }),
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  assert.equal(r.totalValorHorasExtras, 350)
  assert.deepEqual(
    r.recebimentos.map((i) => [i.valor, i.valorHorasExtras]),
    [
      [1500, 262.5],
      [500, 87.5],
    ],
  )
})

caso('rateio proporcional com centavos: resto cai na última e a soma é exata', () => {
  // 100,00 de excedente (1750 − 1650) em 2 parcelas 900/850 → fatias
  // 51,43 + 48,57 (soma exata 100).
  const periodo = definirPeriodo('mes', '2026-06-15')
  const plan = [
    entrada('2026-06-12', 900, { ano_semana_trabalho: 2026, semana_trabalho: 23 }),
    entrada('2026-06-25', 850, { ano_semana_trabalho: 2026, semana_trabalho: 23 }),
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  assert.deepEqual(
    r.recebimentos.map((i) => i.valorHorasExtras),
    [51.43, 48.57],
  )
  const soma = r.recebimentos.reduce((a, b) => a + b.valorHorasExtras, 0)
  assert.equal(soma, 100)
  assert.equal(r.totalValorHorasExtras, 100)
})

caso('semana parcelada: apenas as parcelas DO PERÍODO entram no rateio', () => {
  // O pagamento de uma 3ª parcela chega no mês SEGUINTE: o rateio de junho
  // divide o excedente 400 (2050 − 1650) entre as DUAS parcelas de junho
  // (200/200), sem reservar a fatia da parcela que ainda não entrou no
  // relatório.
  const periodo = definirPeriodo('mes', '2026-06-15')
  const plan = [
    entrada('2026-06-12', 1025, { ano_semana_trabalho: 2026, semana_trabalho: 23 }),
    entrada('2026-06-25', 1025, { ano_semana_trabalho: 2026, semana_trabalho: 23 }),
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  assert.deepEqual(
    r.recebimentos.map((i) => i.valorHorasExtras),
    [200, 200],
  )
  assert.equal(r.totalValorHorasExtras, 400)
})

// ============================================================================
// 13.4) SEMANA COM FERIADO — o extra é recebido − fixo (não os 400 do Ponto)
// ============================================================================
caso('semana com feriado: recebido 1800 → extra 150 (e não 400 do bruto)', () => {
  // Exemplo real de 06/05/2026: trabalho da semana 27/04–03/05 (Dia do
  // Trabalho). O Ponto DESCONTA o dia no fixo: o fechamento bruto marca 400
  // (valorHe+valorDomfer), mas o recebido foi 1.800 — o EXTRA REAL do
  // relatório é 1800 − 1650 = 150. A semana seguinte (04/05, dom 10/05) paga
  // 2.050 → extra 400 (bate exato). Uma semana exata no fixo (1.650) → 0.
  const periodo = definirPeriodo('mes', '2026-05-15')
  const plan = [
    entrada('2026-05-06', 1800, { ano_semana_trabalho: 2026, semana_trabalho: 18 }), // ref 27/04 (feriado)
    entrada('2026-05-13', 2050, { ano_semana_trabalho: 2026, semana_trabalho: 19 }), // ref 04/05 (dom 10/05)
    entrada('2026-05-20', 1650, { ano_semana_trabalho: 2026, semana_trabalho: 20 }), // ref 11/05 (no fixo)
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  assert.equal(r.totalRecebido, 5500)
  assert.equal(r.totalValorHorasExtras, 550) // 150 (feriado) + 400 (dom) + 0
  assert.deepEqual(r.porMes, [{ mes: '2026-05', recebido: 5500, valorHorasExtras: 550 }])
  assert.deepEqual(
    r.porData.map((s) => [s.data, s.recebido, s.valorHorasExtras]),
    [
      ['2026-05-06', 1800, 150],
      ['2026-05-13', 2050, 400],
      ['2026-05-20', 1650, 0],
    ],
  )
  assert.deepEqual(
    r.porSemana.map((s) => [s.semana, s.recebido, s.valorHorasExtras]),
    [
      ['2026-05-04', 1800, 150], // 06/05 → semana civil 04/05
      ['2026-05-11', 2050, 400], // 13/05 → semana civil 11/05
      ['2026-05-18', 1650, 0], //  20/05 → semana civil 18/05
    ],
  )
  assert.deepEqual(
    r.recebimentos.map((i) => [i.data, i.valor, i.valorHorasExtras]),
    [
      ['2026-05-06', 1800, 150],
      ['2026-05-13', 2050, 400],
      ['2026-05-20', 1650, 0],
    ],
  )
})

// ============================================================================
// 13.5) porData — gráfico do Mês: UMA BARRA POR DATA DE RECEBIMENTO
// (bug 2 de 06/09/2026 — a barra não pode mais sumir com os pagamentos de
// começo de mês, e rótulo é a data real, não a segunda-feira do bucket)
// ============================================================================
caso('julho/2026: pagamentos duplicados na MESMA data viram UMA barra; o dia 03/07 não some', () => {
  // Cenário real de julho: 03/07 recebe DOIS períodos de trabalho no mesmo dia,
  // depois 08/07, 17/07, 23/07 e 31/07 → 5 datas de recebimento. Excedentes
  // acima do fixo: 03/07 (150 + 400) e 17/07 (200).
  const periodo = definirPeriodo('mes', '2026-07-15')
  const plan = [
    entrada('2026-07-03', 1800, { ano_semana_trabalho: 2026, semana_trabalho: 26 }), // ref 22/06 → extra 150
    entrada('2026-07-03', 2050, { ano_semana_trabalho: 2026, semana_trabalho: 27 }), // ref 29/06 → extra 400
    entrada('2026-07-08', 1650, { ano_semana_trabalho: 2026, semana_trabalho: 28 }), // ref 06/07 → 0
    entrada('2026-07-17', 1850, { ano_semana_trabalho: 2026, semana_trabalho: 29 }), // ref 13/07 → extra 200
    entrada('2026-07-23', 1650, { ano_semana_trabalho: 2026, semana_trabalho: 30 }), // ref 20/07 → 0
    entrada('2026-07-31', 1650, { ano_semana_trabalho: 2026, semana_trabalho: 31 }), // ref 27/07 → 0
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  assert.equal(r.totalRecebido, 10650)
  assert.equal(r.totalValorHorasExtras, 750)
  assert.deepEqual(r.porMes, [{ mes: '2026-07', recebido: 10650, valorHorasExtras: 750 }])

  // UMA BARRA POR DATA DE RECEBIMENTO: as duas entradas de 03/07 somam na
  // mesma barra (3850); 5 barras, com a própria data como rótulo.
  assert.deepEqual(
    r.porData.map((s) => [s.data, s.recebido, s.valorHorasExtras]),
    [
      ['2026-07-03', 3850, 550], // 1800+2050 (dois períodos pagos no mesmo dia)
      ['2026-07-08', 1650, 0],
      ['2026-07-17', 1850, 200],
      ['2026-07-23', 1650, 0],
      ['2026-07-31', 1650, 0],
    ],
  )

  // A grade da semana civil (porSemana) deixa o 03/07 de fora — a semana
  // 29/06 começa antes do dia 1º (não-repartição). É ESSA a diferença do bug:
  // o gráfico do Mês NÃO usa porSemana; usa porData, então o dia 03/07 tem
  // barra própria.
  assert.deepEqual(
    r.porSemana.map((s) => s.semana),
    ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'],
  )
  assert.ok(!r.porSemana.some((s) => s.semana === '2026-06-29'))
  assert.ok(r.porData.some((s) => s.data === '2026-07-03'))

  // Recebimentos continua UMA linha por pagamento (6 linhas).
  assert.equal(r.recebimentos.length, 6)
})

// ============================================================================
// 14) Escolha porData (Mês) x porMes (demais períodos) — usada pelo hook
// ============================================================================
caso('Mês usa porData; demais períodos usam porMes', () => {
  const dados = calcularRecebidoHoras({
    planejamentosRealizados: [entrada('2026-02-02', 1650, { ano_semana_trabalho: 2026, semana_trabalho: 5 })],
    fixoSemana: FIXO,
    periodo: definirPeriodo('mes', '2026-02-15'),
  })

  // Mesmo período 'mes' → a série alimentada é porData (gráfico por data).
  assert.strictEqual(agrupamentoPorTipoDePeriodo('mes'), 'data')
  assert.strictEqual(
    selecionarSerieDoRelatorio(dados, definirPeriodo('mes', '2026-02-15')),
    dados.porData,
  )

  // Trocar o tipo para Trimestre/Semestre/Ano/Personalizado → volta a porMes.
  for (const chave of ['trimestre', 'semestre', 'ano']) {
    assert.strictEqual(agrupamentoPorTipoDePeriodo(chave), 'mes')
    assert.strictEqual(
      selecionarSerieDoRelatorio(dados, definirPeriodo(chave, '2026-09-01')),
      dados.porMes,
    )
  }
  assert.strictEqual(agrupamentoPorTipoDePeriodo('personalizado'), 'mes')
  const personalizado = definirPeriodoPersonalizado('2026-02-01', '2026-04-30')
  assert.strictEqual(selecionarSerieDoRelatorio(dados, personalizado), dados.porMes)
})

// ============================================================================
// 15) Fixo histórico da planilha: a base da semana é o VALOR SEMANAL da linha
// ============================================================================
caso('fixo histórico: VALOR SEMANAL da linha é a base (jan/2026 fixo 1600 → extra 1160)', () => {
  // Plano de janeiro/2026 originado na planilha (migration 30): a base de cada
  // semana é a coluna B (VALOR SEMANAL) da LINHA — NÃO o fixoSemana atual
  // (1650). A semana 05/01 paga 14/01 com VALOR SEMANAL 1600: 2760 − 1600 =
  // 1160 (e NÃO 1110, que seria 2760 − 1650 da config de hoje).
  const periodo = definirPeriodo('mes', '2026-01-15')
  const plan = [
    entrada('2026-01-14', 2760, { ano_semana_trabalho: 2026, semana_trabalho: 2, valor_semanal: 1600 }),
    entrada('2026-01-21', 1600, { ano_semana_trabalho: 2026, semana_trabalho: 3, valor_semanal: 1600 }),
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  assert.equal(r.totalRecebido, 4360)
  assert.equal(r.totalValorHorasExtras, 1160)
  assert.deepEqual(
    r.recebimentos.map((i) => [i.data, i.valor, i.valorHorasExtras]),
    [
      ['2026-01-14', 2760, 1160],
      ['2026-01-21', 1600, 0],
    ],
  )
  assert.deepEqual(
    r.porData.map((d) => [d.data, d.valorHorasExtras]),
    [
      ['2026-01-14', 1160],
      ['2026-01-21', 0],
    ],
  )
})

// ============================================================================
// 16) Parcela de junho: base = Σ VALOR SEMANAL das parcelas da MESMA semana
// ============================================================================
caso('parcela de junho: base = Σ VALOR SEMANAL (825+825=1650) prevalece sobre a config', () => {
  const periodo = definirPeriodo('mes', '2026-06-15')
  const plan = [
    entrada('2026-06-12', 1025, { ano_semana_trabalho: 2026, semana_trabalho: 23, valor_semanal: 825 }),
    entrada('2026-06-25', 1025, { ano_semana_trabalho: 2026, semana_trabalho: 23, valor_semanal: 825 }),
  ]
  // fixoSemana 2000 ≠ base real (1650) → prova que o valor_semanal das LINHAS
  // vence a config e que a semana conta UMA vez nos totais.
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: 2000, periodo })

  assert.equal(r.totalRecebido, 2050)
  assert.equal(r.totalValorHorasExtras, 400) // 2050 − (825 + 825)
  assert.deepEqual(
    r.recebimentos.map((i) => i.valorHorasExtras),
    [200, 200],
  )
})

// ============================================================================
// 17) Exclusão explícita: acordo trabalhista e Outros fora do "Recebido & horas"
// ============================================================================
caso('acordo e outros ficam FORA do Recebido (origens historico_acordo/outros)', () => {
  const periodo = definirPeriodo('mes', '2026-01-15')
  const plan = [
    entrada('2026-01-07', 2000, { origem: 'historico_planilha' }),
    entrada('2026-01-14', 1650, { origem: 'historico_planilha' }),
    entrada('2026-01-21', 2000, { origem: 'historico_acordo' }),
    entrada('2026-01-28', 4805.8, { origem: 'historico_outros', descricao: 'FGTS (saque aniversário)' }),
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  assert.equal(r.totalRecebido, 3650) // 2000 + 1650 — acordo/outros NÃO entram
  assert.equal(r.recebimentos.length, 2)
  assert.deepEqual(
    r.recebimentos.map((i) => i.valor),
    [2000, 1650],
  )
})

// ============================================================================
// 18) Extra direto do histórico: valor_extra_historico é usado SEM fórmula
// ============================================================================
caso('historico_planilha com valor_extra_historico: o extra é ESSE valor direto', () => {
  const periodo = definirPeriodo('mes', '2026-01-15')
  const plan = [
    // Linha da planilha: valor 2760, fixo histórico 1600, extra GRAVADO 1160.
    entrada('2026-01-14', 2760, {
      origem: 'historico_planilha',
      valor_semanal: 1600,
      valor_extra_historico: 1160,
      ano_semana_trabalho: 2026,
      semana_trabalho: 2,
    }),
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  assert.equal(r.totalRecebido, 2760)
  assert.equal(r.totalValorHorasExtras, 1160) // direto, sem rateio/fórmula
  assert.deepEqual(
    r.recebimentos.map((i) => [i.valor, i.valorHorasExtras]),
    [[2760, 1160]],
  )
})

// ============================================================================
// 19) Linhas sem o dado histórico seguem usando a fórmula (Ponto reconci- liado)
// ============================================================================
caso('sem valor_extra_historico a fórmula continua valendo (linha do Ponto)', () => {
  const periodo = definirPeriodo('mes', '2026-01-15')
  const plan = [
    // Sem valor_extra_historico → a FÓRMULA da base histórica define o extra:
    // 2760 − 1600 (valor_semanal) = 1160, como no caso 15.
    entrada('2026-01-14', 2760, {
      origem: 'manual',
      valor_semanal: 1600,
      ano_semana_trabalho: 2026,
      semana_trabalho: 2,
    }),
  ]
  const r = calcularRecebidoHoras({ planejamentosRealizados: plan, fixoSemana: FIXO, periodo })

  assert.equal(r.totalRecebido, 2760)
  assert.equal(r.totalValorHorasExtras, 1160)
})

console.log(`\n${passou} testes passaram, ${falhou} falharam.`)
if (falhou > 0) process.exit(1)