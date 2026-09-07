// ============================================================================
// RELATÓRIO "ENTRADAS X DESPESAS" — visão geral do fluxo de caixa do período
// ============================================================================
// Lib PURA (sem React/Supabase/DOM): recebe as movimentações das contas JÁ
// consultadas e devolve os totais e as séries do período. A fonte da verdade
// é o MOVIMENTO REAL das contas (decisão com André, 07/09/2026): o pagamento
// da fatura já entra como Saída real na conta (não somamos fatura_pagamentos
// nem parcelas separadas — evita duplicidade) e as transferências INTERNAS
// do próprio usuário são EXCLUÍDAS do fluxo (não são receita nem gasto).
//
// Contrato:
//   calcularEntradasDespesas({ movimentacoes, origens, periodo })
//     → {
//         totalEntradas, totalDespesas, saldo,
//         porMes:    [{ mes, entradas, despesas, saldo,
//                      categorias: { salario, acordo, outros } }],
//         porData:   [{ data, entradas, despesas, saldo,
//                      categorias: { salario, acordo, outros } }],
//         porSemana: [{ semana, entradas, despesas, saldo,
//                      categorias: { salario, acordo, outros } }],
//         lancamentos: [{ data, semana, tipo ('entrada'|'despesa'), valor,
//                        categoria ('salario'|'acordo'|'outros'|null),
//                        descricao }],
//       }
//
//   • movimentacoes  lista de lançamentos de TODAS as contas do usuário na
//     faixa do período. Campos usados: data, tipo_op ('Entrada'|'Saida'),
//     valor, categoria, descricao, id e transferencia_id. Só contam as linhas
//     com data DENTRO do período, valor > 0, tipo_op válido e que NÃO sejam
//     transferência interna — a lib aplica os filtros sozinha (defensiva).
//   • origens         mapa { movimentacao_id → origem } das movimentações
//     criadas por um planejamento (o id da movimentação = lancamento_id do
//     planejamento). Usado só para derivar a categoria das ENTRADAS quando a
//     origem é conhecida; omissão/default {} → tudo vira 'salario'.
//   • periodo        { tipo, inicio, fim } — mesmo formato de periodos.js;
//     limites INCLUSIVOS.
//
// Transferências internas (excluídas do fluxo) — qualquer um destes:
//   • transferencia_id preenchido (transferência do app, RPC criar_transferencia);
//   • categoria 'transferencia'/'Transferência' (nítida ignora case);
//   • categoria 'caixinha' (guardar/resgatar da caixinha — dinheiro sai para
//     a poupança do MESMO usuário e volta no resgate);
//   • descrição contendo 'entre contas' (marca do histórico importado do app
//     antigo, que gravou a transferência como categoria Importado/Manual).
//
// Categorias das ENTRADAS (quebra do gráfico e da lista — decisão 07/09/2026):
//   • 'acordo' → origem 'historico_acordo' (parcelas do acordo trabalhista);
//   • 'outros' → origem 'historico_outros' (FGTS, IRPF e afins da planilha);
//   • 'salario' → TODO o resto (movimentações sem origem conhecida) — a renda
//     de trabalho/principal do período. A categorização mais fina ficará para
//     uma planilha de pré-filtragem revisada manualmente (decisão do André).
//   Despesas não têm categoria (a linha é pintada de vermelho pelo tipo).
//
// Séries (mesma semântica de relatorioRecebidoHoras.js):
//   • porMes    → chave = MÊS CIVIL do lançamento, em ordem cronológica —
//     alimenta o gráfico nas visões Trimestre/Semestre/Ano/Personalizado
//     (barras por mês);
//   • porData   → chave = DATA CIVIL do lançamento (série agregada de
//     inspeção; NÃO alimenta o gráfico desta aba);
//   • porSemana → chave = SEGUNDA-FEIRA ISO da semana civil do lançamento —
//     a série do gráfico da visão MÊS (ver granularidadeDoFluxoDeCaixa);
//   • lancamentos → UMA LINHA POR LANÇAMENTO (entrada OU despesa), ordenada
//     pela data; cada linha carrega o tipo (para a lista pintar verde/vermelho)
//     e a categoria (entradas).
//
// Regras:
//   • Entrada soma +, despesa soma − (saldo);
//   • Semana não é repartida na borda do mês (regra da não-repartição das
//     outras libs): porSemana usa a segunda-feira ISO do dia do lançamento.
// ============================================================================

import { definirPeriodo, deslocarPeriodo, validarFaixaDePeriodo } from './periodos.js'
import { semanaIso } from './semana.js'

function arre2(n) {
  return Math.round(n * 100) / 100
}

// Grade dos meses civis que INTERSECAM o período [inicio, fim], em ordem
// cronológica (inclusive meses parcialmente cobertos — ex.: faixa personalizada
// que começa no dia 15). Reusa a aritmética civil de periodos.js.
function mesesNoPeriodo(inicio, fim) {
  const meses = []
  let mes = definirPeriodo('mes', inicio)
  while (mes.inicio <= fim) {
    meses.push({ chave: mes.inicio.slice(0, 7), inicio: mes.inicio, fim: mes.fim })
    mes = deslocarPeriodo('mes', mes, 1)
  }
  return meses
}

// Grade das semanas ISO (segunda→domingo) cuja SEGUNDA cai dentro do período
// [inicio, fim]. A primeira semana que começa ANTES de inicio fica de fora (a
// semana é atribuída ao mês anterior — regra da não-repartição).
function semanasNoPeriodo(inicio, fim) {
  const semanas = []
  let semana = definirPeriodo('semana', inicio)
  while (semana.inicio < inicio) {
    semana = deslocarPeriodo('semana', semana, 1)
  }
  while (semana.inicio <= fim) {
    semanas.push(semana.inicio)
    semana = deslocarPeriodo('semana', semana, 1)
  }
  return semanas
}

// Mapa origem → categoria de entrada (decisão 07/09/2026). Qualquer origem
// de prefixo 'historico_' que não seja acordo/outros cai em 'salario' por
// padrão — afinal neste relatório "salário" é o recebimento de trabalho.
function categoriaDaOrigem(origem) {
  if (origem === 'historico_acordo') return 'acordo'
  if (origem === 'historico_outros') return 'outros'
  return 'salario'
}

// Movimentação é transferência INTERNA do próprio usuário? (não é fluxo de
// caixa real — o dinheiro só troca de conta/poupança). Ver contrato acima.
function ehTransferenciaInterna(m) {
  if (m.transferencia_id) return true
  const categoria = String(m.categoria ?? '').trim().toLowerCase()
  // 'transferencia'/'Transferência' (prefixo ignora acento) e 'caixinha'
  // (guardar/resgatar da poupança do MESMO usuário).
  if (categoria.includes('transfer') || categoria === 'caixinha') return true
  if (String(m.descricao ?? '').toLowerCase().includes('entre contas')) return true
  return false
}

// Granularidade do gráfico do fluxo de caixa (decisão 06/09/2026):
//   • período MÊS → por SEMANA (segunda-feira ISO do lançamento). Diferente do
//     "Recebido & horas" (que abre por DATA porque lá há poucos pagamentos por
//     mês e cada um precisa aparecer individualmente), aqui há MUITO mais
//     lançamentos (despesas soltas o mês inteiro) — agregar por semana mantém o
//     gráfico legível;
//   • Trimestre/Semestre/Ano/Personalizado → por MÊS (barras mensais).
export function granularidadeDoFluxoDeCaixa(tipo) {
  return tipo === 'mes' ? 'semana' : 'mes'
}

export function calcularEntradasDespesas({ movimentacoes = [], origens = {}, periodo } = {}) {
  if (!periodo) {
    throw new Error('calcularEntradasDespesas espera um periodo ({ inicio, fim }).')
  }

  const { inicio, fim } = validarFaixaDePeriodo(periodo.inicio, periodo.fim)

  // --- UMA LINHA POR LANÇAMENTO (entrada OU despesa) ---------------------
  // Defensivo: filtra aqui também (não confia em quem chamou).
  const lancamentos = (Array.isArray(movimentacoes) ? movimentacoes : [])
    .filter(
      (m) =>
        m &&
        (m.tipo_op === 'Entrada' || m.tipo_op === 'Saida') &&
        String(m.data) >= inicio &&
        String(m.data) <= fim &&
        Number(m.valor) > 0 &&
        !ehTransferenciaInterna(m),
    )
    .map((m) => {
      const entrada = m.tipo_op === 'Entrada'
      return {
        data: String(m.data),
        semana: semanaIso(String(m.data)).inicio,
        tipo: entrada ? 'entrada' : 'despesa',
        valor: arre2(Number(m.valor)),
        categoria: entrada ? categoriaDaOrigem(origens[m.id]) : null,
        descricao: String(m.descricao ?? '').trim(),
      }
    })
    .sort((a, b) => {
      if (a.data !== b.data) return a.data < b.data ? -1 : 1
      // Estável: mantém a ordem de leitura no mesmo dia.
      return (a.tipo === 'entrada' ? 0 : 1) < (b.tipo === 'entrada' ? 0 : 1) ? -1 : 1
    })

  let totalEntradas = 0
  let totalDespesas = 0

  // Mapas das grades para acumulação (chave 'YYYY-MM', data civil e
  // segunda-feira ISO).
  const totalPorMes = new Map()
  for (const m of mesesNoPeriodo(inicio, fim)) {
    totalPorMes.set(m.chave, { entradas: 0, despesas: 0, salario: 0, acordo: 0, outros: 0 })
  }
  const totalPorSemana = new Map()
  for (const s of semanasNoPeriodo(inicio, fim)) {
    totalPorSemana.set(s, { entradas: 0, despesas: 0, salario: 0, acordo: 0, outros: 0 })
  }
  const totalPorData = new Map()

  function somar(caixa, l) {
    if (!caixa) return
    caixa.entradas += l.tipo === 'entrada' ? l.valor : 0
    caixa.despesas += l.tipo === 'despesa' ? l.valor : 0
    if (l.tipo === 'entrada' && l.categoria) caixa[l.categoria] += l.valor
  }

  for (const l of lancamentos) {
    totalEntradas += l.tipo === 'entrada' ? l.valor : 0
    totalDespesas += l.tipo === 'despesa' ? l.valor : 0

    somar(totalPorMes.get(l.data.slice(0, 7)), l)
    somar(totalPorSemana.get(l.semana), l)

    const caixaData = totalPorData.get(l.data) ?? { entradas: 0, despesas: 0, salario: 0, acordo: 0, outros: 0 }
    somar(caixaData, l)
    totalPorData.set(l.data, caixaData)
  }

  const extrairBucket = ([, v]) => ({
    entradas: arre2(v.entradas),
    despesas: arre2(v.despesas),
    saldo: arre2(v.entradas - v.despesas),
    categorias: {
      salario: arre2(v.salario),
      acordo: arre2(v.acordo),
      outros: arre2(v.outros),
    },
  })

  const porMes = [...totalPorMes.entries()]
    .filter(([, v]) => v.entradas > 0 || v.despesas > 0)
    .map(([mes, v]) => ({ mes, ...extrairBucket([mes, v]) }))
    .sort((a, b) => (a.mes < b.mes ? -1 : a.mes > b.mes ? 1 : 0))

  const porSemana = [...totalPorSemana.entries()]
    .filter(([, v]) => v.entradas > 0 || v.despesas > 0)
    .map(([semana, v]) => ({ semana, ...extrairBucket([semana, v]) }))
    .sort((a, b) => (a.semana < b.semana ? -1 : a.semana > b.semana ? 1 : 0))

  const porData = [...totalPorData.entries()]
    .filter(([, v]) => v.entradas > 0 || v.despesas > 0)
    .map(([data, v]) => ({ data, ...extrairBucket([data, v]) }))
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0))

  return {
    totalEntradas: arre2(totalEntradas),
    totalDespesas: arre2(totalDespesas),
    saldo: arre2(totalEntradas - totalDespesas),
    porMes,
    porData,
    porSemana,
    lancamentos,
  }
}