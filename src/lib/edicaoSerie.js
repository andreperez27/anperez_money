// ============================================================================
// EDIÇÃO DE SÉRIE RECORRENTE — função PURA que monta as alterações parciais
// ============================================================================
// 01/09/2026 (decisão com André): a edição da série vale SÓ para o FUTURO
// (regra D4 — realizado/cancelado imutáveis). O EditarSerieForm monta os
// campos e esta função compara com o item de referência da série, devolvendo
// APENAS o que mudou, já no contrato que a rota recorrente de
// calcularRegeneraçãoRecorrente entende:
//   • descricao             → nova descrição do futuro;
//   • valorCentavos         → valor MENSAL (repetido) em centavos;
//   • data_primeira_parcela → nova data da 1ª parcela (a partir de mês+dia);
//   • serie_data_termino    → novo término (null = indefinido).
//
// O item de referência traz campos auxiliares (preenchidos pelo Lancamentos
// antes de abrir o form): __valorMensal (valor da parcela em reais, do 1º
// previsto), __dataInicial (1ª data_prevista da série) e __serieDataTermino.
// Devolve {} quando nada mudou.
// ============================================================================

export function montarRegeneracaoRecorrente({
  item,
  descricao,
  valorCentavos,
  dataPrimeiraParcela,
  serieDataTermino,
  periodicidade,
}) {
  const alteracoes = {}

  const desc = String(descricao ?? '').trim()
  if (desc && desc !== (item.descricao ?? '')) alteracoes.descricao = desc

  const valorAtualCentavos = Math.round(Number(item.__valorMensal ?? item.valor) * 100)
  if (Number.isFinite(valorCentavos) && valorCentavos > 0 && valorCentavos !== valorAtualCentavos) {
    alteracoes.valorCentavos = valorCentavos
  }

  // Periodicidade da série: se mudou (mensal ↔ semanal), a regeneração passa a
  // usar o novo passo. O dia da semana (semanal) é derivado da nova
  // data_primeira_parcela; o dia do mês (mensal), do novo mês+dia — por isso
  // aqui basta registrar a periodicidade; a lib gera as datas via dataDaParcela.
  if (periodicidade !== undefined && periodicidade !== (item.periodicidade ?? 'mensal')) {
    alteracoes.periodicidade = periodicidade
  }

  const dataAtual = item.__dataInicial ?? item.data_prevista
  if (dataPrimeiraParcela && dataPrimeiraParcela !== dataAtual) {
    alteracoes.data_primeira_parcela = dataPrimeiraParcela
  }

  const terminoAtual = item.__serieDataTermino ?? null
  if ((serieDataTermino ?? null) !== terminoAtual) {
    alteracoes.serie_data_termino = serieDataTermino || null
  }

  return alteracoes
}
