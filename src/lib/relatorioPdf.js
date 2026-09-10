// ============================================================================
// RELATÓRIO CONSOLIDADO EM PDF — lib PURA dos blocos de dados (10/09/2026)
// ============================================================================
// Os QUATRO blocos do template único (semana E mês), somente dados REALIZADOS
// (decisão 10/09/2026 — o bloco "esperado x realizado" saiu do relatório):
//   1. Resumo do período        — entradas / saídas / resultado (fluxo real);
//   2. Gasto por categoria      — compras do cartão (por compras.data) +
//                                  movimentações Saida, EXCLUINDO transferências
//                                  internas e pagamento de fatura
//                                  (categoria 'pagamento_fatura' OU 'Fatura
//                                  Cartão' — a compra já conta pela data dela; o
//                                  pagamento lançado na conta duplicaria o
//                                  gasto. Achado 10/09/2026: 16 movimentações
//                                  "Fatura Cartão" em 2026 espelhando compras);
//   3. Faturas e compromissos   — faturas reais + projetadas (v_faturas +
//                                  previstos de destino cartão) com vencimento
//                                  no período + compromissos ainda não lançados
//                                  (previstos não-cartão a partir de hoje);
//   4. Saldos finais            — saldo REAL das contas ativas ao fim do
//                                  período (reconstrução de calcularSaldoReal).
//
// Além dos blocos do PDF, existe aqui a FONTE ÚNICA de categorização de
// lançamentos (lancamentosCategorizados), reusada pela agregação de gastos do
// PDF (calcularGastoPorCategoria), pelo ranking e pela análise/busca por
// categoria do app (analisarCategoria) — a lógica (pular transferência interna,
// pular pagamento de fatura, normalizar o nome da categoria, filtrar a faixa,
// preservar a AUSÊNCIA de categoria como '') NÃO é duplicada.
//
// Decisão "Sem categoria" (10/09/2026): categoria nula/vazia vira a string
// vazia '' na fonte (ausência PRESERVADA) — ela é filtrada de verdade em
// analisarCategoria e é uma opção REAIS do seletor. No agregado de GASTOS
// (calcularGastoPorCategoria, usado no PDF) a ausência SOMA em 'Outros' como
// antes — o relatório não muda. A análise pode incluir também movimentações
// ENTRADA (incluirEntradas) para pegar depósitos sem categoria, que não passam
// pelo formulário de categorização.
// ============================================================================

import { calcularEntradasDespesas } from './relatorioEntradasDespesas.js'
import { montarItensFatura, calcularMesFatura } from './faturaPlanejamento.js'
import { calcularSaldoReal } from './saldoProjetado.js'
import { validarFaixaDePeriodo } from './periodos.js'
import { GRUPOS_CATEGORIAS } from './categorias.js'
import { formatarData } from './compartilhados.js'

function arre2(n) {
  return Math.round(n * 100) / 100
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Token de comparação de categoria: caixa baixa, sem diacríticos (NFD +
// remoção de combining marks) e sem espaços. Assim "Transporte (combustivel)",
// "TRANSPORTE(estacionamento)" e o canônico "Transporte (combustível)"
// convergem para o MESMO token (fechamento 10/09/2026 — variantes históricas
// de acento/espaço caíam indevidamente em 'Outros').
function tokenCategoria(nome) {
  return String(nome ?? '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
}

// Nome canônico da categoria (lista oficial sem variar acentos/caixa/espaço).
// Desconhecida ou vazia converge para 'Outros'.
export function categoriaCanonica(nome) {
  const bruto = String(nome ?? '').trim()
  if (!bruto) return 'Outros'
  const alvo = tokenCategoria(bruto)
  for (const grupo of GRUPOS_CATEGORIAS) {
    for (const cat of grupo.categorias) {
      if (tokenCategoria(cat) === alvo) return cat
    }
  }
  return 'Outros'
}

// Movimentação é transferência INTERNA do próprio usuário? Mesma regra de
// relatorioEntradasDespesas.js (não é gasto — o dinheiro só troca de conta).
function ehTransferenciaInterna(m) {
  if (m.transferencia_id) return true
  const categoria = String(m.categoria ?? '').trim().toLowerCase()
  if (categoria.includes('transfer') || categoria === 'caixinha') return true
  if (String(m.descricao ?? '').toLowerCase().includes('entre contas')) return true
  return false
}

// Pagamento de fatura de cartão lançado na conta corrente? Excluir do GASTO:
// a RPC pagar_fatura grava 'pagamento_fatura', mas o padrão antigo de
// lançamento manual usava a categoria 'Fatura Cartão' (16 casos em 2026 — o
// achado do relatório). Em ambos os casos a compra do cartão JÁ conta pela
// data dela — mantê-las duplicaria o mesmo consumo.
function ehPagamentoFatura(m) {
  const categoria = String(m.categoria ?? '').trim().toLowerCase()
  return categoria === 'pagamento_fatura' || categoria === 'fatura cartão'
}

// Rótulo curto do período para o cabeçalho do PDF (título + faixa).
export function rotuloRelatorioPdf(periodo) {
  if (!periodo) return { titulo: '', faixa: '' }
  if (periodo.tipo === 'semana') {
    return {
      titulo: `Semana ${periodo.semana} / ${periodo.ano}`,
      faixa: `${formatarData(periodo.inicio)} – ${formatarData(periodo.fim)}`,
    }
  }
  if (periodo.tipo === 'mes') {
    const NOME_MES = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
    ]
    return {
      titulo: `${NOME_MES[periodo.mes - 1]} / ${periodo.ano}`,
      faixa: `${formatarData(periodo.inicio)} – ${formatarData(periodo.fim)}`,
    }
  }
  return {
    titulo: periodo.tipo,
    faixa: `${formatarData(periodo.inicio)} – ${formatarData(periodo.fim)}`,
  }
}

// ---------------------------------------------------------------------------
// Bloco 1 — Resumo do período
// ---------------------------------------------------------------------------
// Fonte da verdade: MOVIMENTO REAL das contas (mesma decisão da aba "Entradas
// x despesas"): pagamento de fatura já é a Saída real; transferências internas
// são excluídas. Reusa calcularEntradasDespesas (que filtra sozinha).
export function montarResumo({ movimentacoes = [], periodo }) {
  if (!periodo) {
    throw new Error('montarResumo espera um periodo ({ inicio, fim }).')
  }
  const { totalEntradas, totalDespesas, saldo } = calcularEntradasDespesas({
    movimentacoes,
    periodo,
  })
  return {
    entradas: totalEntradas,
    saidas: totalDespesas,
    resultado: saldo,
  }
}

// ---------------------------------------------------------------------------
// FONTE ÚNICA de categorização — compras + movimentações (Saida, e Entrada
// quando incluirEntradas)
// ---------------------------------------------------------------------------
// Normaliza cada lançamento elegível numa linha única
// { categoria, data, descricao, valor, fonte }, com as MESMAS regras do
// relatório: fora da faixa não entra; movimentação com valor > 0; transferência
// interna (transferencia_id / categoria transferência / caixinha / "entre
// contas") sai nos dois sentidos; pagamento de fatura sai (a compra do cartão
// já conta pela data dela — senão duplicaria).
//
// Categoria: ausência é PRESERVADA — nula/vazia (após trim) vira a string
// vazia '', e só nomes NÃO vazios passam por categoriaCanonica (desconhecidos
// → 'Outros'). Assim dá para filtrar de verdade o grupo "Sem categoria".
// Usada pelo agregado do PDF (calcularGastoPorCategoria), pelo ranking e pela
// busca do app (analisarCategoria) — a lógica não é duplicada.
function lancamentosCategorizados({ movimentacoes = [], compras = [], periodo, incluirEntradas = false }) {
  const { inicio, fim } = validarFaixaDePeriodo(periodo.inicio, periodo.fim)

  const out = []

  for (const m of Array.isArray(movimentacoes) ? movimentacoes : []) {
    if (!m) continue
    if (m.tipo_op !== 'Saida' && !(incluirEntradas && m.tipo_op === 'Entrada')) continue
    if (Number(m.valor) <= 0) continue
    const data = String(m.data ?? '')
    if (data < inicio || data > fim) continue
    if (ehTransferenciaInterna(m)) continue
    if (ehPagamentoFatura(m)) continue
    out.push({
      categoria: categoriaDaFonte(m.categoria, m.descricao),
      data,
      descricao: String(m.descricao ?? '').trim(),
      valor: Number(m.valor),
      fonte: 'movimentacao',
    })
  }

  for (const c of Array.isArray(compras) ? compras : []) {
    if (!c || Number(c.valor_total) <= 0) continue
    const data = String(c.data ?? '')
    if (data < inicio || data > fim) continue
    out.push({
      categoria: categoriaDaFonte(c.categoria, c.descricao),
      data,
      descricao: String(c.descricao ?? '').trim(),
      valor: Number(c.valor_total),
      fonte: 'compra',
    })
  }

  return out.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0))
}

// Ausência ('' ) fica ausência; nome não-vazio passa pela canonização. Regra
// separada de viagem (mantida por decisão 10/09/2026): quando a categoria
// gravada é de transporte (token começa com 'transporte') e a descrição cita
// viagem (ex.: "(viagem)"), o lançamento vai para 'Viagem'. A classificação
// "Transporte por APP" NÃO é heurística de palavra-chave — Uber/99App entram
// na categoria pela migração 34 (dado pontual), não por regra de negócio.
function textoBusca(texto) {
  return String(texto ?? '').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

const RE_VIAGEM = /\bviagem\b/

function categoriaDaFonte(nome, descricao) {
  const bruto = String(nome ?? '').trim()
  if (bruto === '') return ''
  const token = tokenCategoria(bruto)
  if (token.startsWith('transporte') && RE_VIAGEM.test(textoBusca(descricao))) {
    return 'Viagem'
  }
  return categoriaCanonica(bruto)
}

// ---------------------------------------------------------------------------
// Bloco 2 — Gasto por categoria
// ---------------------------------------------------------------------------
// Agrega TODAS as categorias de GASTO do período (movimentações Saida +
// compras), a partir da fonte única. Nome desconhecido → 'Outros'; ausência de
// categoria SOMA em 'Outros' também (comportamento histórico do PDF — o
// relatório não muda).
export function calcularGastoPorCategoria({ movimentacoes = [], compras = [], periodo }) {
  if (!periodo) {
    throw new Error('calcularGastoPorCategoria espera um periodo ({ inicio, fim }).')
  }

  const totais = new Map()
  for (const l of lancamentosCategorizados({ movimentacoes, compras, periodo })) {
    const chave = l.categoria === '' ? 'Outros' : l.categoria
    totais.set(chave, arre2((totais.get(chave) ?? 0) + l.valor))
  }

  const linhas = [...totais.entries()]
    .map(([categoria, valor]) => ({ categoria, valor }))
    .sort((a, b) => b.valor - a.valor || (a.categoria < b.categoria ? -1 : 1))
  const total = arre2(linhas.reduce((acc, l) => acc + l.valor, 0))

  return { linhas, total }
}

// ---------------------------------------------------------------------------
// Análise / busca por categoria (app, fora do PDF)
// ---------------------------------------------------------------------------
// Filtra a fonte única numa ÚNICA categoria e devolve o total somado + a lista
// de lançamentos que o compõem (data, descrição, valor e fonte — compra ou
// movimentação), em ordem cronológica. O total é SEMPRE a soma exata da lista
// entregue (regra coberta por teste).
//
// 'categoria' vazio/nulo filtra a AUSÊNCIA (lançamentos de categoria nula ou
// vazia). Por padrão inclui movimentações Entrada (depósitos sem categoria que
// não passam pelo formulário de categorização); passe incluirEntradas=false
// para restringir a gastos (uso do ranking, se um dia precisar).
export function analisarCategoria({
  categoria,
  movimentacoes = [],
  compras = [],
  periodo,
  limite = 200,
  incluirEntradas = true,
}) {
  if (!periodo) {
    throw new Error('analisarCategoria espera um periodo ({ inicio, fim }).')
  }
  const nome = String(categoria ?? '')
  const alvo = nome.trim() === '' ? '' : categoriaCanonica(nome)

  const todos = lancamentosCategorizados({
    movimentacoes,
    compras,
    periodo,
    incluirEntradas,
  })
    .filter((l) => l.categoria === alvo)
    .map((l) => ({
      data: l.data,
      descricao: l.descricao,
      valor: arre2(l.valor),
      fonte: l.fonte,
    }))

  const total = arre2(todos.reduce((acc, l) => acc + l.valor, 0))
  return {
    categoria: alvo,
    total,
    lancamentos: todos.slice(0, limite),
  }
}

// ---------------------------------------------------------------------------
// Aba "Por categoria" (app) — visão e ordem
// ---------------------------------------------------------------------------
// Valor sentinela do select para "nenhuma categoria selecionada ancora" (mostra
// o ranking geral). É DIFERENTE de '' — '' significa a opção real "Sem
// categoria", que deve abrir o resultado filtrado.
export const TODAS_CATEGORIAS = '__todas__'

// Orquestrador da aba: decide qual visão renderizar primeiro com base na
// seleção. Regra da UX (10/09/2026): enquanto nenhuma categoria está
// selecionada, a visão padrão é o RANKING geral; assim que ALGUÉMA seleção
// existe (categoria específica OU "Sem categoria"), o resultado filtrado é
// computado e a visão vira 'detalhe' — a página o renderiza no TOPO, antes do
// ranking (que fica secundário/collapsado). Testável sem componente: a visão e
// o detalhe não-nulos já validam a regra de ordenação.
export function montarDadosAbaCategoria({
  selecao = TODAS_CATEGORIAS,
  movimentacoes = [],
  compras = [],
  periodo,
  limite,
}) {
  const resumo = calcularGastoPorCategoria({ movimentacoes, compras, periodo })
  const detalhe =
    selecao === TODAS_CATEGORIAS
      ? null
      : analisarCategoria({ categoria: selecao, movimentacoes, compras, periodo, limite })

  return {
    selecao,
    visao: detalhe ? 'detalhe' : 'resumo',
    resumo,
    detalhe,
  }
}

// ---------------------------------------------------------------------------
// Bloco 3 — Faturas e compromissos
// ---------------------------------------------------------------------------
// Faturas: combina o dado REAL (v_faturas) com os PREVISTOS de destino cartão
// (projeção), via a MESMA lib do Planejamento (montarItensFatura) — vencimento
// real (dia útil) dentro do período. Compromissos: previstos AINDA NÃO
// lançados (estado 'previsto'), fora de destino cartão (esses entram na
// projeção da fatura), com data no período e a partir de hoje — os próximos.
export function calcularFaturasECompromissos({
  faturasReais = [],
  previstosCartao = [],
  cartoes = [],
  itens = [],
  periodo,
  hojeISO,
  feriados = [],
  limiteCompromissos = 10,
}) {
  if (!periodo) {
    throw new Error('calcularFaturasECompromissos espera um periodo ({ inicio, fim }).')
  }
  const { inicio, fim } = validarFaixaDePeriodo(periodo.inicio, periodo.fim)
  const hoje = hojeISO || ''

  // Mesma agregação de previstosPorCartaoMes da projeção do Planejamento:
  // soma os previstos de destino cartão pelo MÊS DE FATURA calculado.
  const cartaoPorId = new Map((cartoes || []).map((c) => [c.id, c]))
  for (const fr of faturasReais || []) {
    if (fr?.cartao?.id && !cartaoPorId.has(fr.cartao.id)) {
      cartaoPorId.set(fr.cartao.id, fr.cartao)
    }
  }
  const previstosPorCartaoMes = {}
  for (const item of previstosCartao || []) {
    if (item.estado !== 'previsto' || item.destino_padrao !== 'cartao') continue
    const cartao = cartaoPorId.get(item.cartao_padrao_id)
    if (!cartao || !cartao.dia_fechamento) continue
    const mes = calcularMesFatura(item.data_prevista, cartao.dia_fechamento)
    if (!previstosPorCartaoMes[item.cartao_padrao_id]) {
      previstosPorCartaoMes[item.cartao_padrao_id] = {}
    }
    previstosPorCartaoMes[item.cartao_padrao_id][mes] =
      (previstosPorCartaoMes[item.cartao_padrao_id][mes] ?? 0) + Number(item.valor || 0)
  }

  const faturas = montarItensFatura({
    faturasReais,
    previstosPorCartaoMes,
    inicioISO: inicio,
    fimISO: fim,
    cartoes,
    feriados,
  }).map((f) => ({
    id: f.id,
    descricao: f.descricao,
    data: f.data_prevista,
    valor: arre2(Number(f.valor)),
    tipo: f.tipo,
    valor_real: arre2(Number(f.valor_real)),
    valor_previsto: arre2(Number(f.valor_previsto)),
  }))

  const compromissos = (Array.isArray(itens) ? itens : [])
    .filter(
      (i) =>
        i &&
        i.estado === 'previsto' &&
        i.destino_padrao !== 'cartao' &&
        i.data_prevista >= inicio &&
        i.data_prevista <= fim &&
        (!hoje || i.data_prevista >= hoje),
    )
    .sort((a, b) => (a.data_prevista < b.data_prevista ? -1 : a.data_prevista > b.data_prevista ? 1 : 0))
    .slice(0, limiteCompromissos)
    .map((i) => ({
      data: i.data_prevista,
      descricao: String(i.descricao ?? '').trim(),
      valor: arre2(Number(i.valor || 0)),
    }))

  return { faturas, compromissos }
}

// ---------------------------------------------------------------------------
// Bloco 4 — Saldos finais
// ---------------------------------------------------------------------------
// Saldo REAL de cada conta ativa ao fim do período (reconstrução a partir do
// saldo atual, subtraindo movimentações posteriores ao fim). Conta inativa não
// participa. Período anterior à cobertura da busca → null (UI mostra "—").
export function calcularSaldosFinais({ contas = [], movimentacoes = [], fimISO, coberturaMinima }) {
  const fim = String(fimISO ?? '')
  if (!fim) {
    throw new Error('calcularSaldosFinais espera fimISO (YYYY-MM-DD).')
  }

  const linhas = []
  let total = 0
  let totalValido = true

  for (const conta of (contas || []).filter((c) => c && c.ativa)) {
    const movsDaConta = (movimentacoes || []).filter((m) => m && m.conta_id === conta.id)
    const saldo = calcularSaldoReal({
      saldoAtual: Number(conta.saldo_atual),
      movimentacoes: movsDaConta,
      dataAlvo: fim,
      coberturaMinima,
    })
    if (saldo === null) {
      totalValido = false
    } else {
      total += saldo
    }
    linhas.push({
      conta_id: conta.id,
      nome: String(conta.nome ?? 'Conta'),
      saldo: saldo === null ? null : arre2(saldo),
    })
  }

  return {
    contas: linhas,
    total: totalValido ? arre2(total) : null,
  }
}

// ---------------------------------------------------------------------------
// Orquestrador — monta todos os blocos de uma vez (uso da página / hook).
// ---------------------------------------------------------------------------
export function montarBlocosRelatorio({
  periodo,
  movimentacoes = [],
  itens = [],
  compras = [],
  faturasReais = [],
  previstosCartao = [],
  cartoes = [],
  contas = [],
  movimentacoesSaldo = [],
  hojeISO,
  feriados = [],
  coberturaMinima,
}) {
  return {
    resumo: montarResumo({ movimentacoes, periodo }),
    gastoCategoria: calcularGastoPorCategoria({ movimentacoes, compras, periodo }),
    faturasCompromissos: calcularFaturasECompromissos({
      faturasReais,
      previstosCartao,
      cartoes,
      itens,
      periodo,
      hojeISO,
      feriados,
    }),
    saldosFinais: calcularSaldosFinais({
      contas,
      movimentacoes: movimentacoesSaldo,
      fimISO: periodo.fim,
      coberturaMinima,
    }),
  }
}