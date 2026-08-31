// ============================================================================
// FATURA AUTOMÁTICA NO PLANEJAMENTO — lib PURA (sem Supabase, testável).
// ============================================================================
// Converte a "fatura" do cartão em um ITEM SINTÉTICO do Planejamento. O item
// NÃO é gravado no banco: é calculado dinamicamente sempre que o Planejamento
// é consultado, garantindo que compras novas entradas antes do fechamento
// apareçam sozinhas.
//
// Evolução (fatura PROJETADA):
//   • Além do dado REAL de v_faturas (compras já lançadas de fato), a fatura
//     agrega os PLANEJAMENTOS ainda 'previsto' com destino Cartão cujo mês de
//     fatura (mesmo cartão) bate com o mês. Serve para ver hoje quanto a fatura
//     de meses futuros vai pesar, mesmo antes de qualquer parcela ser lançada.
//   • Uma entrada por (cartão, mês) dentro do período visível, com:
//       tipo          'real' | 'projetada'
//       valor_real    (v_faturas) — só o que existe de fato no banco
//       valor_previsto (soma dos previstos de destino cartão daquele mês)
//       valor         = valor_real + valor_previsto (o exibido)
//   • O botão "Pagar fatura" só opera em fatura REAL (valor_real) — nunca em
//     previstos, pois a RPC pagar_fatura valida contra o Postgres.
//
// Contrato: NÃO altera a lógica de cálculo de fatura do backend
// (v_faturas/calcular_mes_fatura). Aqui só replicamos o ESPELHO de
// calcular_mes_fatura (para o mesmo mês de referência), derivamos o
// vencimento e montamos o objeto de exibição.
// ============================================================================

// ESPELHO fiel do SQL calcular_mes_fatura (migration 10_cartoes_schema).
// p_data_compra → dataIso (YYYY-MM-DD), p_dia_fechamento → diaFechamento.
// Regras idênticas ao backend:
//   • dia_fechamento > último dia do mês => fechamento efetivo = último dia;
//   • compra após o fechamento efetivo => mês seguinte (com virada de ano).
export function calcularMesFatura(dataIso, diaFechamento) {
  const [ano, mes, diaCompra] = String(dataIso).split('-').map(Number)
  const ultimo = new Date(ano, mes, 0).getDate()
  const diaEfetivo = Math.min(diaFechamento, ultimo)
  let mesFatura = mes
  let anoFatura = ano
  if (diaCompra > diaEfetivo) {
    mesFatura = mes + 1
    if (mesFatura > 12) {
      mesFatura = 1
      anoFatura = ano + 1
    }
  }
  return `${anoFatura}-${String(mesFatura).padStart(2, '0')}`
}

// Data de vencimento da fatura a partir do 'YYYY-MM' + dia de vencimento.
// Mesma regra do módulo Cartões (FaturaDetalhe): dia > último dia do mês é
// ajustado para o último dia válido (clamp, meses curtos).
export function vencimentoISO(mesStr, diaVenc) {
  const dia = Math.max(1, Number(diaVenc) || 1)
  const [ano, m] = String(mesStr).split('-').map(Number)
  const ultimo = new Date(ano, m, 0).getDate()
  const diaFinal = Math.min(dia, ultimo)
  return `${ano}-${String(m).padStart(2, '0')}-${String(diaFinal).padStart(2, '0')}`
}

// Monta UM item sintético de fatura para um (cartão, mes).
// - faturaReal: linha de v_faturas daquele mês (ou null/undefined se não houver).
// - valorPrevisto: soma dos previstos de destino cartão daquele mês (0 se nenhum).
// - tipo: 'real' quando há valor real em v_faturas (existe fatura de fato);
//   'projetada' quando o mês só tem previstos (não há parcela real ainda).
export function montarItemFatura({ cartao, mes, faturaReal, valorPrevisto }) {
  if (!cartao || !mes) return null
  const valorReal = faturaReal ? Number(faturaReal.valor_restante) : 0
  const previsto = Number(valorPrevisto) || 0
  const valor = valorReal + previsto
  if (!(valor > 0)) return null

  const nomeCartao = cartao.nome || 'cartão'
  const ehReal = valorReal > 0
  return {
    id: `fatura:${cartao.id}:${mes}`,
    fatura: true,
    tipo: ehReal ? 'real' : 'projetada',
    fatura_cartao_id: cartao.id,
    fatura_nome: nomeCartao,
    fatura_mes: mes,
    valor_real: valorReal,
    valor_previsto: previsto,
    tipo_op: 'Saida',
    descricao: ehReal
      ? `Fatura cartão ${nomeCartao}`
      : `Projeção fatura cartão ${nomeCartao}`,
    valor,
    data_prevista: vencimentoISO(mes, cartao.dia_vencimento),
    estado: 'previsto',
    origem: 'fatura',
    destino_padrao: 'cartao',
    cartao_padrao_id: cartao.id,
    serie_id: null,
    parcela_numero: null,
    total_parcelas: null,
    observacao: null,
    criado_em: new Date().toISOString(),
  }
}

// Gera UM item de fatura por (cartão, mes) dentro da faixa [inicioISO, fimISO],
// combinando dado real de v_faturas + previstos de destino cartão.
//
// - faturasReais: [{ cartao, mes, valor_restante }]  (todos os meses, do hook)
// - previstosPorCartaoMes: { [cartao_id]: { [mes]: somaCentavos } }
//   (soma dos previstos 'previsto' com destino cartão por mes_calculado)
// - cartoes: [{ id, nome, dia_fechamento, dia_vencimento }] — usados para
//   resolver o cartão de previstos que ainda não têm fatura real (necessário
//   para projetar meses futuros).
//
// Retorna os itens ordenados por data_prevista, filtrando pelo vencimento.
export function montarItensFatura({ faturasReais, previstosPorCartaoMes, inicioISO, fimISO, cartoes }) {
  if (!faturasReais && !previstosPorCartaoMes) return []
  const inicio = inicioISO || ''
  const fim = fimISO || ''

  // Conjunto de (cartao_id, mes) a emitir = união de meses reais + previstos.
  const porChave = new Map() // `cartao_id|mes` -> { cartao, mes }
  const cartaoPorId = new Map((cartoes || []).map((c) => [c.id, c]))

  for (const fr of faturasReais || []) {
    if (!fr || !fr.cartao?.id || !fr.mes) continue
    if (!cartaoPorId.has(fr.cartao.id)) cartaoPorId.set(fr.cartao.id, fr.cartao)
    porChave.set(`${fr.cartao.id}|${fr.mes}`, { cartao: fr.cartao, mes: fr.mes })
  }
  for (const cartaoId of Object.keys(previstosPorCartaoMes || {})) {
    const cartao = cartaoPorId.get(cartaoId)
    if (!cartao) continue
    for (const mes of Object.keys(previstosPorCartaoMes[cartaoId] || {})) {
      porChave.set(`${cartaoId}|${mes}`, { cartao, mes })
    }
  }

  const faturaRealPorChave = new Map()
  for (const fr of faturasReais || []) {
    if (!fr || !fr.cartao?.id || !fr.mes) continue
    faturaRealPorChave.set(`${fr.cartao.id}|${fr.mes}`, fr)
  }

  const itens = []
  for (const { cartao, mes } of porChave.values()) {
    const item = montarItemFatura({
      cartao,
      mes,
      faturaReal: faturaRealPorChave.get(`${cartao.id}|${mes}`),
      valorPrevisto: (previstosPorCartaoMes?.[cartao.id]?.[mes]) || 0,
    })
    if (!item) continue
    if (inicio && item.data_prevista < inicio) continue
    if (fim && item.data_prevista > fim) continue
    itens.push(item)
  }

  return itens.sort((a, b) =>
    a.data_prevista < b.data_prevista ? -1 : a.data_prevista > b.data_prevista ? 1 : 0,
  )
}
