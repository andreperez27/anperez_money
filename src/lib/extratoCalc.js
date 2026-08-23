// ============================================================================
// Cálculos puros do extrato — sem Supabase, sem React.
// ============================================================================
// Existem num arquivo próprio para: (1) haver UMA única definição da fórmula
// de reconciliação; (2) poderem ser testados direto no Node
// (scripts/teste_reconciliacao.mjs) sem banco nem navegador.
//
// FÓRMULA (regra do módulo):
//
//   saldo_atual (autoridade: trigger atualizar_saldo)
//     = saldo_de_abertura            (linhas com data < início)
//     + entradas                     (fluxo real, SEM transferências)
//     - saídas                       (fluxo real, SEM transferências)
//     + transferências_líquidas      (recebidas - enviadas; patrimonial)
//     + efeito_das_linhas_futuras    (data > fim do período, quando a
//                                     pesquisa termina antes delas)
//
// "Saldo no fim do período" = abertura + entradas - saídas + transferências.
// Ele pode DIFERIR do saldo_atual quando existem lançamentos futuros — isso
// NÃO é erro e nunca deve ser mascarado (proibido sobrescrever o cálculo
// com o saldo_atual).
// ============================================================================

// Efeito líquido de um conjunto de linhas NO SALDO da conta: Entrada soma,
// Saída subtrai. Transferência interna entra naturalmente porque, em cada
// conta, ela é uma linha própria (Saída na origem, Entrada no destino) —
// exatamente como o trigger contabiliza. Linhas de caixinha (guardar/
// resgatar) também são movimentações comuns, sem caso especial.
export function somarEfeito(linhas) {
  return linhas.reduce(
    (soma, l) => soma + (l.tipo_op === 'Entrada' ? 1 : -1) * Number(l.valor),
    0,
  )
}

// Resumo do período separado nos conceitos que NÃO se misturam:
//   entradas/saidas  → fluxo financeiro real (transferência não é um nem outro)
//   transferencias   → movimento patrimonial líquido (recebidas − enviadas)
//   saldo            = entradas − saidas + transferencias  (efeito no saldo)
export function resumirMovimentacoes(movimentacoes) {
  const ehTransferencia = (m) => m.categoria === 'transferencia'
  let entradas = 0
  let saidas = 0
  let recebidas = 0
  let enviadas = 0

  for (const m of movimentacoes) {
    const valor = Number(m.valor)
    if (ehTransferencia(m)) {
      // Patrimonial: entra no saldo, mas fora de Entradas/Saídas.
      if (m.tipo_op === 'Entrada') recebidas += valor
      else enviadas += valor
    } else if (m.tipo_op === 'Entrada') {
      entradas += valor
    } else {
      saidas += valor
    }
  }

  return {
    entradas,
    saidas,
    transfRecebidas: recebidas,
    transfEnviadas: enviadas,
    transferencias: recebidas - enviadas,
    saldo: entradas - saidas + (recebidas - enviadas),
  }
}

// SALDO_NO_FIM_DO_PERÍODO = abertura + saldo do período. Exige abertura
// conhecida (período com data inicial); sem ela devolve null e a tela não
// mostra o card. Derivado das linhas — JAMAIS copiado do saldo_atual.
export function saldoNoFimDoPeriodo(saldoAbertura, resumo) {
  if (saldoAbertura === null || saldoAbertura === undefined) return null
  return saldoAbertura + resumo.saldo
}

// ---------------------------------------------------------------------------
// JANELA "Últimos N" (ordenacao data DESC, criado_em DESC, id ASC)
// ---------------------------------------------------------------------------
// A janela não tem datas: começa na LINHA mais antiga exibida (a última da
// lista) e vai até a mais recente. O saldo de abertura da janela é o efeito
// de TODAS as linhas com prioridade de ordenação MENOR que essa linha de
// borda — inclusive linhas do MESMO DIA cortadas pelo limite, por isso não
// basta `data < D`: dentro do mesmo dia a ordem é criado_em DESC (o mais
// recente vem primeiro; ficam FORA os de criado_em MENOR que a borda) e,
// empatando, id ASC (ficam fora os de id MAIOR). Esta função monta o filtro
// PostgREST equivalente ao "complemento da janela" na ordem documentada,
// para a abertura sair exatamente do ponto onde a lista começa.
export function montarFiltroAntesDaJanela(ultimaLinha) {
  const { data, criado_em, id } = ultimaLinha
  return [
    `data.lt.${data}`,
    `and(data.eq.${data},criado_em.lt.${criado_em})`,
    `and(data.eq.${data},criado_em.eq.${criado_em},id.gt.${id})`,
  ].join(',')
}

// ---------------------------------------------------------------------------
// SALDO PROGRESSIVO (coluna "Saldo" do extrato, linha a linha)
// ---------------------------------------------------------------------------
// Recebe as linhas NA ORDEM DO HOOK (data desc, criado_em desc, id asc) e a
// abertura já validada; percorre do MAIS ANTIGO para o mais novo aplicando o
// efeito real de cada linha na conta (Entrada soma, Saída subtrai — mesma
// regra de somarEfeito; transferências entram naturalmente porque cada lado
// é uma linha própria). Conta em CENTAVOS para não acumular deriva de ponto
// flutuante numa corrida longa. Devolve Map id → saldo após aquela linha;
// sem abertura conhecida devolve null (a tela mostra '—').
export function saldosProgressivos(movimentacoes, abertura) {
  if (abertura === null || abertura === undefined) return null
  let centavos = Math.round(abertura * 100)
  const mapa = new Map()
  for (let i = movimentacoes.length - 1; i >= 0; i--) {
    const m = movimentacoes[i]
    centavos += (m.tipo_op === 'Entrada' ? 1 : -1) * Math.round(Number(m.valor) * 100)
    mapa.set(m.id, centavos / 100)
  }
  return mapa
}
