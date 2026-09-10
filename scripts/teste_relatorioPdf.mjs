import assert from 'node:assert/strict'
import {
  categoriaCanonica,
  montarResumo,
  analisarCategoria,
  calcularGastoPorCategoria,
  calcularFaturasECompromissos,
  calcularSaldosFinais,
  montarBlocosRelatorio,
  montarDadosAbaCategoria,
  TODAS_CATEGORIAS,
  rotuloRelatorioPdf,
} from '../src/lib/relatorioPdf.js'

// ============================================================================
// Testes dos BLOCOS DE DADOS do relatório consolidado em PDF (10/09/2026).
// Rodar: node scripts/teste_relatorioPdf.mjs
//
// Cobrem os 4 blocos do template único (semana e mês) e a análise/busca por
// categoria do app (analisarCategoria + montarDadosAbaCategoria), incluindo:
//   - a regra "total == soma exata da lista entregue";
//   - "Sem categoria": lançamentos de categoria nula/vazia (incl. depósitos
//     Entrada) são encontrados e separados de 'Outros';
//   - UX da aba: com seleção a visão vira 'detalhe' (resultado filtrado no
//     topo), sem seleção a visão é 'resumo' (ranking geral).
// Não testamos render do PDF (jsPDF) — só a camada de dados pura (mesma
// filosofia das demais libs do projeto).
// ============================================================================

let ok = 0
let falhou = 0

function caso(nome, fn) {
  try {
    fn()
    ok += 1
    console.log(`ok      — ${nome}`)
  } catch (e) {
    falhou += 1
    console.log(`FALHOU  — ${nome}`)
    console.log(`        ${e.message}`)
  }
}

// Período de referência: agosto/2026 (segundas-feiras 03, 10, 17, 24 e 31).
const MES = { tipo: 'mes', ano: 2026, mes: 8, inicio: '2026-08-01', fim: '2026-08-31' }
const SEMANA = { tipo: 'semana', ano: 2026, semana: 32, inicio: '2026-08-03', fim: '2026-08-09' }

function mov(id, extras) {
  return { id, data: '2026-08-10', tipo_op: 'Saida', valor: 0, categoria: '', descricao: '', ...extras }
}

function planejado(id, extras) {
  return {
    id,
    tipo_op: 'Saida',
    descricao: 'item',
    valor: 0,
    data_prevista: '2026-08-10',
    estado: 'previsto',
    destino_padrao: 'conta',
    cartao_padrao_id: null,
    serie_id: null,
    parcela_numero: null,
    total_parcelas: null,
    ...extras,
  }
}

// --- categoriaCanonica ------------------------------------------------

caso('categoriaCanonica normaliza caixa/acento e converte desconhecida para Outros', () => {
  assert.strictEqual(categoriaCanonica('supermercado'), 'Supermercado')
  assert.strictEqual(categoriaCanonica('  Energia  '), 'Energia')
  assert.strictEqual(categoriaCanonica('zzz'), 'Outros')
  assert.strictEqual(categoriaCanonica(''), 'Outros')
  assert.strictEqual(categoriaCanonica(null), 'Outros')
})

caso('categoriaCanonica ignora acento e espaços ausentes (variantes históricas)', () => {
  // Variantes reais encontradas no banco (10/09/2026): sem acento e/ou sem
  // o espaço antes do parênteses. Antes da normalização caíam em 'Outros'.
  assert.strictEqual(categoriaCanonica('Transporte (combustivel)'), 'Transporte (combustível)')
  assert.strictEqual(categoriaCanonica('Transporte(Estacionamento)'), 'Transporte (estacionamento)')
  assert.strictEqual(categoriaCanonica('transporte (COMBUSTIVEL)'), 'Transporte (combustível)')
  assert.strictEqual(categoriaCanonica('SAUDE E FARMACIA'), 'Saúde e Farmácia')
  assert.strictEqual(categoriaCanonica('Padaria e   Confeitaria'), 'Padaria e Confeitaria')
  assert.strictEqual(categoriaCanonica('Transporte por App'), 'Transporte por APP')
})

caso('sem heurística: Uber reaproveita categoria gravada; "Transporte por APP" e viagem são dados/regra separados', () => {
  // A classificação 'Transporte por APP' NÃO é palavra-chave — as 3× Uber foram
  // migradas por id (migration 34). Uma movimentação com a categoria gravada
  // 'Transporte' (sem migração) cai em 'Outros'; a canônica 'Transporte por
  // APP' (já migrada) permanece; a regra separada de "(viagem)" segue valendo.
  const LANC = [
    mov('u0', { data: '2026-08-10', valor: 40, categoria: 'Transporte', descricao: 'Uber' }),
    mov('u1', { data: '2026-08-11', valor: 135.99, categoria: 'Transporte por APP', descricao: 'Uber' }),
    mov('u2', { data: '2026-08-12', valor: 11.94, categoria: 'Transporte por APP', descricao: '99App' }),
    mov('u3', { data: '2026-08-13', valor: 50, categoria: 'Transporte por APP', descricao: 'Uber (viagem)' }),
    mov('u5', { data: '2026-08-15', valor: 30, categoria: 'Transporte (combustível)', descricao: 'Auto Posto San Pietro' }),
  ]
  const r = calcularGastoPorCategoria({ periodo: MES, movimentacoes: LANC, compras: [] })
  const porCategoria = {}
  for (const l of r.linhas) porCategoria[l.categoria] = l.valor
  assert.strictEqual(porCategoria['Transporte por APP'], 147.93) // 135.99 + 11.94
  assert.strictEqual(porCategoria['Viagem'], 50)
  assert.strictEqual(porCategoria['Transporte (combustível)'], 30)
  assert.strictEqual(porCategoria['Outros'], 40) // 'Transporte' genérico + 'Uber' NÃO é reclassificado por código

  const detalhe = analisarCategoria({ categoria: 'Transporte por APP', movimentacoes: LANC, compras: [], periodo: MES })
  assert.strictEqual(detalhe.total, 147.93)
  assert.strictEqual(detalhe.lancamentos.length, 2)
})

// --- Bloco 1: Resumo -------------------------------------------------

caso('resumo do mês soma entradas/saídas e exclui transferências internas', () => {
  const resumo = montarResumo({
    periodo: MES,
    movimentacoes: [
      mov('a', { data: '2026-08-05', tipo_op: 'Entrada', valor: 5000, descricao: 'Salário' }),
      mov('b', { data: '2026-08-10', tipo_op: 'Saida', valor: 800, descricao: 'Aluguel' }),
      mov('c', { data: '2026-08-07', tipo_op: 'Saida', valor: 100, categoria: 'Transferência', transferencia_id: 't1' }),
      mov('d', { data: '2026-08-15', tipo_op: 'Saida', valor: 60, descricao: 'entre contas' }),
      mov('e', { data: '2026-08-20', tipo_op: 'Saida', valor: 40, categoria: 'Caixinha' }),
      mov('f', { data: '2026-07-31', tipo_op: 'Entrada', valor: 999 }),
    ],
  })
  assert.strictEqual(resumo.entradas, 5000)
  assert.strictEqual(resumo.saidas, 800)
  assert.strictEqual(resumo.resultado, 4200)
})

caso('resumo da semana só considera lançamentos da faixa', () => {
  const resumo = montarResumo({
    periodo: SEMANA,
    movimentacoes: [
      mov('a', { data: '2026-08-05', tipo_op: 'Entrada', valor: 5000 }),
      mov('b', { data: '2026-08-07', tipo_op: 'Saida', valor: 100, transferencia_id: 't1' }),
      mov('c', { data: '2026-08-10', tipo_op: 'Saida', valor: 800 }),
    ],
  })
  assert.strictEqual(resumo.entradas, 5000)
  assert.strictEqual(resumo.saidas, 0)
  assert.strictEqual(resumo.resultado, 5000)
})

// --- Bloco 2: Gasto por categoria ------------------------------------

caso('gasto por categoria soma compras + saídas, canoniza e exclui pagamento/transferência', () => {
  const r = calcularGastoPorCategoria({
    periodo: MES,
    movimentacoes: [
      mov('m1', { data: '2026-08-10', valor: 50, categoria: 'Supermercado' }),
      mov('m2', { data: '2026-08-15', valor: 30, categoria: 'supermercado' }), // canoniza p/ Supermercado
      mov('m3', { data: '2026-08-16', valor: 40, categoria: '' }), // → Outros
      mov('m4', { data: '2026-08-17', valor: 10, categoria: 'zzz' }), // → Outros
      mov('m5', { data: '2026-08-11', valor: 2000, categoria: 'pagamento_fatura' }), // excluído
      mov('m6', { data: '2026-08-12', valor: 100, categoria: 'Transferência', transferencia_id: 'x' }), // excluído
      mov('m7', { data: '2026-08-13', valor: 80, categoria: 'Caixinha' }), // excluído
    ],
    compras: [
      { id: 'c1', data: '2026-08-12', categoria: 'Supermercado', valor_total: 120, ativa: true },
      { id: 'c2', data: '2026-08-05', categoria: 'Energia', valor_total: 90, ativa: true },
      { id: 'c3', data: '2026-08-20', categoria: null, valor_total: 7, ativa: true },
      { id: 'c4', data: '2026-09-01', categoria: 'Supermercado', valor_total: 999, ativa: true }, // fora da faixa
    ],
  })
  assert.strictEqual(r.linhas[0].categoria, 'Supermercado')
  assert.strictEqual(r.linhas[0].valor, 200) // 50 + 30 + 120
  const porCategoria = {}
  for (const l of r.linhas) porCategoria[l.categoria] = l.valor
  assert.strictEqual(porCategoria['Energia'], 90)
  assert.strictEqual(porCategoria['Outros'], 57)
  assert.strictEqual(porCategoria['pagamento_fatura'], undefined)
  assert.strictEqual(r.total, 347)
  // Ordenado decrescente de valor.
  assert.deepStrictEqual(
    r.linhas.map((l) => l.valor),
    [...r.linhas.map((l) => l.valor)].sort((a, b) => b - a),
  )
})

caso('gasto por categoria NÃO duplica: compra categorizada + movimentação "Fatura Cartão"', () => {
  // Achado 10/09/2026: 16 pagamentos de fatura lançados na conta com a
  // categoria 'Fatura Cartão' (2026-01..08) espelhavam compras individuais
  // já categorizadas. O pagamento NÃO pode somar de novo — senão o mesmo
  // consumo aparece uma vez pela compra e outra pelo pagamento.
  const r = calcularGastoPorCategoria({
    periodo: MES,
    movimentacoes: [
      mov('f1', { data: '2026-08-11', valor: 1200, categoria: 'Fatura Cartão', descricao: 'Pagamento Cartao de Credito' }),
      mov('f2', { data: '2026-08-23', valor: 600, categoria: 'fatura cartão', descricao: 'Pagamento Cartão de Credito' }),
      mov('f3', { data: '2026-08-10', valor: 200, categoria: 'pagamento_fatura', descricao: 'Pagamento fatura PJ' }),
      // Lançamento REAL de consumo no período (não é fatura) — deve entrar.
      mov('f4', { data: '2026-08-15', valor: 55, categoria: 'Supermercado' }),
    ],
    compras: [
      { id: 'kf1', data: '2026-08-01', categoria: 'Casa e Utensílios', valor_total: 800, ativa: true },
      { id: 'kf2', data: '2026-08-02', categoria: 'Supermercado', valor_total: 700, ativa: true },
    ],
  })
  // Faturas (as três) somem; entram só as compras (1500) e o consumo real (55).
  assert.strictEqual(r.total, 1555)
  const porCategoria = {}
  for (const l of r.linhas) porCategoria[l.categoria] = l.valor
  assert.strictEqual(porCategoria['Fatura Cartão'], undefined)
  assert.strictEqual(porCategoria['pagamento_fatura'], undefined)
  assert.strictEqual(porCategoria['Supermercado'], 755)
  assert.strictEqual(porCategoria['Casa e Utensílios'], 800)
})

caso('analisarCategoria também deixa "Fatura Cartão" de fora (mesma fonte)', () => {
  const r = analisarCategoria({
    categoria: 'Fatura Cartão',
    movimentacoes: [
      mov('g1', { data: '2026-08-11', valor: 1200, categoria: 'Fatura Cartão' }),
      mov('g2', { data: '2026-08-09', valor: 100, categoria: 'Supermercado' }),
    ],
    compras: [],
    periodo: MES,
  })
  assert.strictEqual(r.total, 0)
  assert.deepStrictEqual(r.lancamentos, [])
})

// --- Análise / busca por categoria (app) --------------------------

const LANC_MOVS = [
  mov('a1', { data: '2026-08-02', valor: 123.45, categoria: 'Supermercado', descricao: 'Mercado centro' }),
  mov('a2', { data: '2026-08-12', valor: 60, categoria: 'supermercado', descricao: 'Padaria' }),
  mov('a3', { data: '2026-08-13', valor: 30, categoria: 'SUPERMERCADO', descricao: 'Feira' }),
  mov('a4', { data: '2026-08-20', valor: 40, categoria: 'Energia', descricao: 'Luz' }),
  mov('a5', { data: '2026-08-11', valor: 5000, categoria: 'pagamento_fatura', descricao: 'Fatura cartão' }),
  mov('a6', { data: '2026-08-15', valor: 200, categoria: 'Transferência', transferencia_id: 't', descricao: 'Troca' }),
  mov('a7', { data: '2026-09-02', valor: 999, categoria: 'Supermercado', descricao: 'Fora da faixa' }),
  // --- dados de "Sem categoria" e 'Outros' (análise 10/09/2026) ---
  mov('a8', { data: '2026-08-18', valor: 12.34, categoria: 'zzz', descricao: 'Desconhecida' }), // 'Outros'
  mov('a9', { data: '2026-08-22', valor: 3000, tipo_op: 'Entrada', categoria: null, descricao: 'Depósito' }), // sem categoria
  mov('a10', { data: '2026-08-19', valor: 33, categoria: '', descricao: 'Saida sem categoria' }), // sem categoria
  mov('a11', { data: '2026-08-23', valor: 500, tipo_op: 'Entrada', categoria: '', transferencia_id: 't2', descricao: 'Entrada de transferência' }), // fora
  mov('a12', { data: '2026-08-24', valor: 500, categoria: '', transferencia_id: 't2', descricao: 'Saida de transferência' }), // fora
]
const LANC_COMPRAS = [
  { id: 'k1', data: '2026-08-09', categoria: 'Supermercado', valor_total: 80, descricao: 'Compra cartão' },
  { id: 'k2', data: '2026-08-21', categoria: null, valor_total: 7, descricao: 'Sem categoria' },
]

caso('analisarCategoria: filtra e canoniza categoria combinada ignorando acento/caixa, com total == soma', () => {
  const r = analisarCategoria({
    categoria: 'sUpErMeRcAdO',
    movimentacoes: LANC_MOVS,
    compras: LANC_COMPRAS,
    periodo: MES,
  })
  assert.strictEqual(r.categoria, 'Supermercado')
  // 123.45 + 60 + 30 + 80 = 293.45 (pagamento_fatura, transferência e a de
  // setembro ficam de fora; a compra sem categoria não é Supermercado).
  assert.strictEqual(r.total, 293.45)
  assert.strictEqual(r.lancamentos.length, 4)
  // Ordem cronológica.
  assert.deepStrictEqual(
    r.lancamentos.map((l) => l.data),
    ['2026-08-02', '2026-08-09', '2026-08-12', '2026-08-13'],
  )
  // Total é EXATAMENTE a soma da lista entregue (regra central).
  assert.strictEqual(
    r.total,
    Math.round(r.lancamentos.reduce((acc, l) => acc + l.valor, 0) * 100) / 100,
  )
  // Uma compra (fonte 'compra') e três movimentações.
  assert.strictEqual(r.lancamentos.find((l) => l.fonte === 'compra').valor, 80)
  assert.strictEqual(r.lancamentos.filter((l) => l.fonte === 'compra').length, 1)
})

caso('analisarCategoria: categoria desconhecida (valor não-vazio) devolve os lançamentos de Outros', () => {
  const r = analisarCategoria({
    categoria: 'zzz',
    movimentacoes: LANC_MOVS,
    compras: LANC_COMPRAS,
    periodo: MES,
  })
  // 'Outros' = só nomes não-vazios fora da lista oficial. A ausência (null/'')
  // NÃO é Outros — ela pertence a "Sem categoria" (teste abaixo).
  assert.strictEqual(r.categoria, 'Outros')
  assert.strictEqual(r.total, 12.34) // só a8 (zzz)
  assert.strictEqual(r.lancamentos.length, 1)
  assert.deepStrictEqual(
    { data: r.lancamentos[0].data, valor: r.lancamentos[0].valor, fonte: r.lancamentos[0].fonte },
    { data: '2026-08-18', valor: 12.34, fonte: 'movimentacao' },
  )
})

caso('analisarCategoria "Sem categoria": retorna lançamentos de categoria nula/vazia, incluindo depósito', () => {
  const r = analisarCategoria({
    categoria: '',
    movimentacoes: LANC_MOVS,
    compras: LANC_COMPRAS,
    periodo: MES,
  })
  assert.strictEqual(r.categoria, '') // ausência preservada (não virou 'Outros')
  // a9 (depósito Entrada 3000) + a10 (saída 33) + k2 (compra 7); a11/a12 são
  // transferências internas e ficam FORA mesmo sem categoria.
  assert.strictEqual(r.total, 3040)
  assert.strictEqual(r.lancamentos.length, 3)
  // Ordem cronológica: a10 (19/08), k2 (21/08), a9 (22/08).
  assert.deepStrictEqual(
    r.lancamentos.map((l) => l.data),
    ['2026-08-19', '2026-08-21', '2026-08-22'],
  )
  // O depósito de pagamento recebido aparece (fonte movimentação, tipo Entrada).
  const deposito = r.lancamentos.find((l) => l.descricao === 'Depósito')
  assert.ok(deposito)
  assert.strictEqual(deposito.valor, 3000)
  assert.strictEqual(deposito.fonte, 'movimentacao')
  // Total == soma exata da lista entregue (regra central).
  assert.strictEqual(
    r.total,
    Math.round(r.lancamentos.reduce((acc, l) => acc + l.valor, 0) * 100) / 100,
  )
})

caso('analisarCategoria "Sem categoria": incluirEntradas=false restringe a gastos (depósito sai)', () => {
  const r = analisarCategoria({
    categoria: '',
    movimentacoes: LANC_MOVS,
    compras: LANC_COMPRAS,
    periodo: MES,
    incluirEntradas: false,
  })
  assert.strictEqual(r.total, 40) // a10 (33) + k2 (7); o depósito Entrada não entra
  assert.strictEqual(r.lancamentos.length, 2)
  assert.ok(r.lancamentos.every((l) => l.descricao !== 'Depósito'))
})

caso('analisarCategoria: respeita o limite e total soma todos (mesmo além do limite)', () => {
  const r = analisarCategoria({
    categoria: 'Energia',
    movimentacoes: LANC_MOVS,
    compras: LANC_COMPRAS,
    periodo: MES,
    limite: 1,
  })
  // Só há 1 lançamento de Energia na faixa — nada a truncar aqui; garantimos a
  // invariante total == soma mesmo com o corte.
  assert.strictEqual(r.total, 40)
  assert.strictEqual(r.lancamentos.length, 1)
  assert.strictEqual(
    r.total,
    Math.round(r.lancamentos.reduce((acc, l) => acc + l.valor, 0) * 100) / 100,
  )
  // Caso com corte real: vários lançamentos, limite menor que o total.
  const coberto = analisarCategoria({
    categoria: 'Supermercado',
    movimentacoes: LANC_MOVS,
    compras: LANC_COMPRAS,
    periodo: MES,
    limite: 2,
  })
  assert.strictEqual(coberto.lancamentos.length, 2) // 02/08 e 09/08 (primeiros cronológicos)
  assert.strictEqual(coberto.total, 293.45) // total NÃO é truncado pelo limite
})

caso('montarDadosAbaCategoria (UX): sem seleção a visão é o ranking; com seleção o detalhe vem no topo', () => {
  const base = { movimentacoes: LANC_MOVS, compras: LANC_COMPRAS, periodo: MES }

  // Nenhuma categoria selecionada (sentinela TODAS_CATEGORIAS) → visão
  // 'resumo', detalhe NÃO é computado (ranking geral é a tela padrão).
  const padrao = montarDadosAbaCategoria({ ...base, selecao: TODAS_CATEGORIAS })
  assert.strictEqual(padrao.visao, 'resumo')
  assert.strictEqual(padrao.detalhe, null)
  assert.ok(padrao.resumo.linhas.length > 0)

  // Categoria específica selecionada → visão 'detalhe': a página renderiza o
  // resultado filtrado logo após o seletor (antes do ranking). O detalhe é
  // computado de forma PRIORITÁRIA — o teste valida a estrutura que dirige a
  // ordem de renderização.
  const especifica = montarDadosAbaCategoria({ selecao: 'sUpErMeRcAdO', ...base })
  assert.strictEqual(especifica.visao, 'detalhe')
  assert.ok(especifica.detalhe)
  assert.strictEqual(especifica.detalhe.categoria, 'Supermercado')
  // Invariante central: o total do detalhe é a soma exata da lista entregue.
  assert.strictEqual(
    especifica.detalhe.total,
    Math.round(especifica.detalhe.lancamentos.reduce((acc, l) => acc + l.valor, 0) * 100) / 100,
  )

  // "Sem categoria" selecionada também abre a visão 'detalhe' (é UMA seleção,
  // não "nenhuma seleção") — e o depósito Entrada aparece.
  const semCategoria = montarDadosAbaCategoria({ selecao: '', ...base })
  assert.strictEqual(semCategoria.visao, 'detalhe')
  assert.ok(semCategoria.detalhe)
  assert.strictEqual(semCategoria.detalhe.categoria, '')
  assert.ok(semCategoria.detalhe.lancamentos.some((l) => l.descricao === 'Depósito'))
})

// --- Bloco 3: Faturas e compromissos ---------------------------------

const CARTOES = [{ id: 'c1', nome: 'Nubank', dia_fechamento: 25, dia_vencimento: 1 }]
const FATURAS_REAIS = [
  { cartao: CARTOES[0], mes: '2026-08', valor_restante: 400 },
  { cartao: CARTOES[0], mes: '2026-07', valor_restante: 700 }, // vencimento em julho → fora
]
const PREVISTOS_CARTAO = [
  planejado('pc1', { cartao_padrao_id: 'c1', destino_padrao: 'cartao', data_prevista: '2026-08-10', valor: 150 }),
  planejado('pc2', { cartao_padrao_id: 'c1', destino_padrao: 'cartao', data_prevista: '2026-08-28', valor: 50 }), // mês de fatura 09 → fora
]

caso('faturas: combina real + previsto do cartão e filtra pelo vencimento no período', () => {
  const r = calcularFaturasECompromissos({
    periodo: MES,
    faturasReais: FATURAS_REAIS,
    previstosCartao: PREVISTOS_CARTAO,
    cartoes: CARTOES,
    feriados: [],
    itens: [],
    hojeISO: '2026-08-19',
  })
  assert.strictEqual(r.faturas.length, 1)
  assert.strictEqual(r.faturas[0].descricao, 'Fatura cartão Nubank')
  assert.strictEqual(r.faturas[0].tipo, 'real')
  assert.strictEqual(r.faturas[0].valor, 550) // 400 real + 150 previsto
  assert.strictEqual(r.faturas[0].data, '2026-08-03') // vencimento dia 01→próximo dia útil
})

caso('faturas: mês sem fatura real gera projeção a partir dos previstos de cartão', () => {
  const r = calcularFaturasECompromissos({
    periodo: MES,
    faturasReais: [],
    previstosCartao: PREVISTOS_CARTAO,
    cartoes: CARTOES,
    itens: [],
    hojeISO: '2026-08-19',
  })
  assert.strictEqual(r.faturas.length, 1)
  assert.strictEqual(r.faturas[0].tipo, 'projetada')
  assert.strictEqual(r.faturas[0].valor, 150)
  assert.strictEqual(r.faturas[0].descricao, 'Projeção fatura cartão Nubank')
})

caso('compromissos: só previstos não-cartão, daqui pra frente, ordenados e limitados', () => {
  const r = calcularFaturasECompromissos({
    periodo: MES,
    faturasReais: FATURAS_REAIS,
    previstosCartao: PREVISTOS_CARTAO,
    cartoes: CARTOES,
    hojeISO: '2026-08-19',
    itens: [
      planejado('x1', { data_prevista: '2026-08-20', valor: 80, descricao: 'Internet' }),
      planejado('x2', { data_prevista: '2026-08-05', valor: 90 }), // antes de hoje → fora
      planejado('x3', { data_prevista: '2026-08-25', valor: 60, destino_padrao: 'cartao', cartao_padrao_id: 'c1' }), // cartão → entra na fatura
      planejado('x4', { data_prevista: '2026-08-22', valor: 70, estado: 'realizado' }), // já lançado → fora
      planejado('x5', { data_prevista: '2026-08-21', valor: 30, descricao: 'Plano de saúde' }),
      planejado('x6', { data_prevista: '2026-07-10', valor: 50 }), // fora do período
    ],
  })
  assert.deepStrictEqual(
    r.compromissos.map((c) => c.descricao),
    ['Internet', 'Plano de saúde'],
  )
  assert.deepStrictEqual(r.compromissos[0], { data: '2026-08-20', descricao: 'Internet', valor: 80 })
})

// --- Bloco 4: Saldos finais ------------------------------------------

const CONTAS = [
  { id: 'a1', nome: 'Principal', ativa: true, saldo_atual: 1000 },
  { id: 'a2', nome: 'Poupança', ativa: true, saldo_atual: 500 },
  { id: 'a3', nome: 'Antiga', ativa: false, saldo_atual: 99999 },
]
const MOV_SALDO = [
  { conta_id: 'a1', data: '2026-08-10', tipo_op: 'Entrada', valor: 200 },
  { conta_id: 'a1', data: '2026-08-20', tipo_op: 'Saida', valor: 100 },
  { conta_id: 'a2', data: '2026-09-05', tipo_op: 'Entrada', valor: 50 },
  { conta_id: 'a3', data: '2026-08-12', tipo_op: 'Entrada', valor: 90 }, // conta inativa → ignorada
]

caso('saldos finais: reconstrói saldo real ao fim do período e ignora conta inativa', () => {
  const r = calcularSaldosFinais({
    contas: CONTAS,
    movimentacoes: MOV_SALDO,
    fimISO: '2026-08-05',
    coberturaMinima: '2025-06-01',
  })
  assert.strictEqual(r.contas.length, 2)
  assert.strictEqual(r.contas.find((c) => c.conta_id === 'a1').saldo, 900) // 1000 −200 (entrada após) +100 (saída após)
  assert.strictEqual(r.contas.find((c) => c.conta_id === 'a2').saldo, 450) // 500 −50 (entrada após)
  assert.strictEqual(r.total, 1350)
})

caso('saldos finais: fim antes da cobertura devolve null (não inventa número)', () => {
  const r = calcularSaldosFinais({
    contas: CONTAS,
    movimentacoes: MOV_SALDO,
    fimISO: '2025-01-01',
    coberturaMinima: '2025-06-01',
  })
  assert.strictEqual(r.total, null)
  assert.ok(r.contas.every((c) => c.saldo === null))
})

caso('saldos finais: sem movimentações posteriores o saldo é o saldo atual', () => {
  const r = calcularSaldosFinais({
    contas: CONTAS,
    movimentacoes: MOV_SALDO,
    fimISO: '2026-12-31',
    coberturaMinima: '2025-06-01',
  })
  assert.strictEqual(r.contas.find((c) => c.conta_id === 'a1').saldo, 1000)
  assert.strictEqual(r.total, 1500)
})

// --- Orquestrador + rótulo -------------------------------------------

caso('montarBlocosRelatorio devolve os 4 blocos coerentes com o período', () => {
  const blocos = montarBlocosRelatorio({
    periodo: MES,
    movimentacoes: [
      mov('a', { data: '2026-08-05', tipo_op: 'Entrada', valor: 5000 }),
      mov('b', { data: '2026-08-10', valor: 800 }),
    ],
    itens: [],
    compras: [{ id: 'c1', data: '2026-08-12', categoria: 'Supermercado', valor_total: 120 }],
    faturasReais: FATURAS_REAIS,
    previstosCartao: PREVISTOS_CARTAO,
    cartoes: CARTOES,
    contas: CONTAS,
    movimentacoesSaldo: MOV_SALDO,
    hojeISO: '2026-08-19',
    coberturaMinima: '2025-06-01',
  })
  assert.strictEqual(blocos.resumo.resultado, 4200)
  // Maior gasto é a saída sem categoria (800) → 'Outros'; Supermercado (120) também entra.
  const categorias = blocos.gastoCategoria.linhas.map((l) => l.categoria)
  assert.strictEqual(blocos.gastoCategoria.linhas[0].categoria, 'Outros')
  assert.ok(categorias.includes('Supermercado'))
  assert.strictEqual(blocos.faturasCompromissos.faturas.length, 1)
  assert.strictEqual(blocos.saldosFinais.contas.length, 2)
})

caso('rotuloRelatorioPdf devolve título e faixa de semana e mês', () => {
  assert.deepStrictEqual(rotuloRelatorioPdf(SEMANA), {
    titulo: 'Semana 32 / 2026',
    faixa: '03/08/2026 – 09/08/2026',
  })
  const r = rotuloRelatorioPdf(MES)
  assert.strictEqual(r.titulo, 'Agosto / 2026')
  assert.strictEqual(r.faixa, '01/08/2026 – 31/08/2026')
})

// --- Resumo ----------------------------------------------------------

console.log('')
console.log(`Resultado: ${ok} ok, ${falhou} falhou.`)
if (falhou > 0) process.exit(1)