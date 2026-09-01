// ============================================================================
// DOMÍNIO DE SÉRIES DE PLANEJAMENTO — núcleo PURA e testável (ETAPA 06/E5-D)
// ============================================================================
// Reflete a decisão D3: Planejamento é o núcleo (tabela de ocorrências); uma
// SÉRIE é apenas um tipo de programação — um conjunto de ocorrências ligadas
// por serie_id. Avulsas continuam sendo a linha sem nenhum campo de série.
//
// Esta lib aplica as REGRAS do domínio que envolvem matemática/estado:
//   • montarLinhasSerie            → geração + semana, sem tocar no Supabase;
//   • calcularCancelamentoDaqui…  → quais ocorrências cancelar (D5);
//   • calcularRegeneração          → recriação do futuro, preservando o passado
//                                    realizado/cancelado (decisão D4).
//
// O hook (usePlanejamentos.js) ORQUESTRA o Supabase/RLS usando estas funções;
// nenhuma delas importa banco, React ou hooks. A semana vem SEMPRE da fonte
// única src/lib/semana.js (nunca é calculada "na mão").
//
// Consequência de projeto: regra única de série fica AQUI e é testável
// isoladamente (scripts/teste_planejamentosSerie.mjs) sem Supabase — sem
// mocks complexos e sem mudar a arquitetura.
// ============================================================================

import { semanaIso } from './semana.js'
import {
  gerarOcorrenciasDaSerie,
  repetirValorEmOcorrencias,
  dataDaParcela,
} from './parcelas.js'
import { totalParcelasRecorrencia } from './recorrenciaCalc.js'

// ----------------------------------------------------------------------------
// Linhas prontas para INSERT no Supabase, a partir do contrato de uma série.
// Gera as ocorrências via parcelas.js e, para CADA uma, calcula a dupla de
// semana exclusivamente por semanaIso(data_prevista). Toda linha nasce
// estado = 'previsto'. NÃO escreve user_id nem lancamento_id (banco/RLS/futuro).
// ----------------------------------------------------------------------------
export function montarLinhasSerie(dados) {
  const ocorrencias = gerarOcorrenciasDaSerie(dados)

  return ocorrencias.map((o) => {
    const { ano, semana } = semanaIso(o.data_prevista)
    const linha = {
      tipo_op: o.tipo_op,
      descricao: o.descricao,
      valor: o.valor,
      data_prevista: o.data_prevista,
      ano_semana: ano,
      semana,
      estado: 'previsto',
      serie_id: o.serie_id,
      parcela_numero: o.parcela_numero,
      total_parcelas: o.total_parcelas,
    }
    if (o.origem !== undefined) linha.origem = o.origem
    if (o.conta_destino_id !== undefined) linha.conta_destino_id = o.conta_destino_id
    if (o.destino_padrao !== undefined) linha.destino_padrao = o.destino_padrao
    if (o.cartao_padrao_id !== undefined) linha.cartao_padrao_id = o.cartao_padrao_id
    if (o.observacao !== undefined) linha.observacao = o.observacao
    return linha
  })
}

// ----------------------------------------------------------------------------
// CANCELAR SÉRIE A PARTIR DE UMA OCORRÊNCIA (decisão D5).
// Devolve os ids das ocorrências DA MESMA SÉRIE, com parcela_numero >= o da
// alvo e estado = 'previsto'. Nunca inclui realizadas nem parcelas anteriores.
// Lança erro explícito quando a alvo não existe ou não é de série.
// ----------------------------------------------------------------------------
export function calcularCancelamentoDaquiParaFrente(ocorrencias, alvoId) {
  if (!Array.isArray(ocorrencias)) {
    throw new Error('Série inválida: esperava-se uma lista de ocorrências.')
  }
  const alvo = ocorrencias.find((o) => o.id === alvoId)
  if (!alvo) {
    throw new Error('Planejamento não encontrado.')
  }
  if (!alvo.serie_id) {
    throw new Error('Ocorrência não pertence a uma série.')
  }

  const ids = ocorrencias
    .filter(
      (o) =>
        o.serie_id === alvo.serie_id &&
        o.estado === 'previsto' &&
        o.parcela_numero >= alvo.parcela_numero,
    )
    .map((o) => o.id)

  return { serieId: alvo.serie_id, parcelaAlvo: alvo.parcela_numero, ids }
}

// ----------------------------------------------------------------------------
// REGENERAÇÃO DE SÉRIE (decisão D4 + §9/§10).
// O passado (realizado e cancelado) é IMUTÁVEL; o futuro (previsto) é recriado
// a partir dos novos parâmetros. Devolve:
//   • linhasParaInserir      → novas ocorrências 'previsto' (com semana),
//                              já SEM os números preservados;
//   • idsPrevistoARemover    → ocorrências 'previsto' antigas a DELETAR;
//   • numerosPreservados     → números ocupados por realizado/cancelado;
//   • novoTotalParcelas/Centavos → valores efetivos usados.
// Regras:
//   • nunca permitir total_parcelas < maior parcela JÁ REALIZADA;
//   • novoTotalCentavos default = soma atual da série (preserva o total);
//   • dataPrimeira default  = menor data_prevista da série (mantém o ritmo);
//   • tipo_op/origem são mantidos; descricao/observacao/conta podem mudar e
//     valem para o NOVO futuro (os realizadas conservam os próprios valores).
// ----------------------------------------------------------------------------
export function calcularRegeneração(serie, alteracoes) {
  if (!Array.isArray(serie) || serie.length === 0) {
    throw new Error('Série vazia ou não encontrada.')
  }

  // Ordenação determinística para escolher a ocorrência de referência.
  const ordenadas = [...serie].sort(
    (a, b) =>
      (a.parcela_numero ?? 0) - (b.parcela_numero ?? 0) ||
      String(a.criado_em || '').localeCompare(String(b.criado_em || '')),
  )
  const ref = ordenadas[0]
  const serieId = ref.serie_id

  const realizadas = serie.filter((o) => o.estado === 'realizado')
  const maiorRealizada = realizadas.reduce(
    (maior, o) => Math.max(maior, o.parcela_numero ?? 0),
    0,
  )

  const numerosPreservados = new Set(
    serie
      .filter((o) => o.estado === 'realizado' || o.estado === 'cancelado')
      .map((o) => o.parcela_numero),
  )

  const idsPrevistoARemover = serie
    .filter((o) => o.estado === 'previsto')
    .map((o) => o.id)

  const novoTotalCentavos =
    alteracoes?.total_centavos ??
    serie.reduce((soma, o) => soma + Math.round(o.valor * 100), 0)

  const novoTotalParcelas = alteracoes?.total_parcelas ?? ref.total_parcelas

  if (novoTotalParcelas < maiorRealizada) {
    throw new Error(
      `Não é possível reduzir para ${novoTotalParcelas} parcela(s): a maior parcela já realizada é ${maiorRealizada}.`,
    )
  }

  const dataPrimeira =
    alteracoes?.data_primeira_parcela ??
    serie.reduce(
      (menor, o) => (o.data_prevista < menor ? o.data_prevista : menor),
      serie[0].data_prevista,
    )

  const linhas = montarLinhasSerie({
    serieId,
    tipoOp: ref.tipo_op,
    descricao: alteracoes?.descricao ?? ref.descricao,
    totalCentavos: novoTotalCentavos,
    totalParcelas: novoTotalParcelas,
    dataPrimeiraParcela: dataPrimeira,
    periodicidade:
      alteracoes?.periodicidade !== undefined
        ? alteracoes.periodicidade
        : ref.periodicidade,
    origem: ref.origem,
    contaDestinoId:
      alteracoes?.conta_destino_id !== undefined
        ? alteracoes.conta_destino_id
        : ref.conta_destino_id,
    destinoPadrao:
      alteracoes?.destino_padrao !== undefined
        ? alteracoes.destino_padrao
        : ref.destino_padrao,
    cartaoPadraoId:
      alteracoes?.cartao_padrao_id !== undefined
        ? alteracoes.cartao_padrao_id
        : ref.cartao_padrao_id,
    observacao:
      alteracoes?.observacao !== undefined
        ? alteracoes.observacao
        : ref.observacao,
  })

  // Números já resolvidos (realizado/cancelado) não são re-inseridos: o
  // passado não se repete no futuro.
  const linhasParaInserir = linhas.filter(
    (linha) => !numerosPreservados.has(linha.parcela_numero),
  )

  return {
    serieId,
    linhasParaInserir,
    idsPrevistoARemover,
    numerosPreservados: [...numerosPreservados],
    novoTotalParcelas,
    novoTotalCentavos,
  }
}

// ----------------------------------------------------------------------------
// REGENERAÇÃO DE SÉRIE RECORRENTE (fixa mensal) — mesmo espírito da
// calcularRegeneração (D4): passado realizado/cancelado imutável, futuro
// previsto recriado. A diferença é o VALOR: em vez de dividir um total, repete
// o valor da parcela (montarLinhasRecorrentes). Aceita, em alteracoes:
//   • descricao, valorCentavos (valor MENSAL repetido), data_primeira_parcela;
//   • total_parcelas opcional (padrão = atual; se a série tem
//     serie_data_termino e a data inicial mudou, o total é recalculado pelos
//     meses até o término — mesma regra da criação);
//   • conta/destino/cartao/observacao opcionais (mesma política da D4).
// Bloqueia reduzir o total abaixo da maior parcela já realizada.
// ----------------------------------------------------------------------------
export function calcularRegeneraçãoRecorrente(serie, alteracoes) {
  if (!Array.isArray(serie) || serie.length === 0) {
    throw new Error('Série vazia ou não encontrada.')
  }

  const ordenadas = [...serie].sort(
    (a, b) =>
      (a.parcela_numero ?? 0) - (b.parcela_numero ?? 0) ||
      String(a.criado_em || '').localeCompare(String(b.criado_em || '')),
  )
  const ref = ordenadas[0]
  const serieId = ref.serie_id

  const realizadas = serie.filter((o) => o.estado === 'realizado')
  const maiorRealizada = realizadas.reduce(
    (maior, o) => Math.max(maior, o.parcela_numero ?? 0),
    0,
  )

  const numerosPreservados = new Set(
    serie
      .filter((o) => o.estado === 'realizado' || o.estado === 'cancelado')
      .map((o) => o.parcela_numero),
  )

  const idsPrevistoARemover = serie
    .filter((o) => o.estado === 'previsto')
    .map((o) => o.id)

  const valorCentavos =
    alteracoes?.valorCentavos ?? Math.round(Number(ref.valor) * 100)

  const dataPrimeira =
    alteracoes?.data_primeira_parcela ??
    serie.reduce(
      (menor, o) => (o.data_prevista < menor ? o.data_prevista : menor),
      serie[0].data_prevista,
    )

  let novoTotalParcelas = alteracoes?.total_parcelas
  if (novoTotalParcelas === undefined) {
    const novoTermino =
      alteracoes?.serie_data_termino !== undefined
        ? alteracoes.serie_data_termino
        : ref.serie_data_termino
    // Recalcula do zero quando há término (existente ou editado) — mesma
    // regra da criação (totalParcelasRecorrencia). Sem término fica no total
    // atual (indefinida = 24 meses prorrogável, preservado na edição).
    if (novoTermino) {
      novoTotalParcelas = totalParcelasRecorrencia(
        dataPrimeira.slice(0, 7),
        novoTermino,
      )
    } else {
      novoTotalParcelas = ref.total_parcelas
    }
  }

  if (novoTotalParcelas < maiorRealizada) {
    throw new Error(
      `Não é possível reduzir para ${novoTotalParcelas} parcela(s): a maior parcela já realizada é ${maiorRealizada}.`,
    )
  }

  const linhas = montarLinhasRecorrentes({
    serieId,
    tipoOp: ref.tipo_op,
    descricao: alteracoes?.descricao ?? ref.descricao,
    valorCentavos,
    totalParcelas: novoTotalParcelas,
    dataPrimeiraParcela: dataPrimeira,
    origem: ref.origem,
    contaDestinoId:
      alteracoes?.conta_destino_id !== undefined
        ? alteracoes.conta_destino_id
        : ref.conta_destino_id,
    destinoPadrao:
      alteracoes?.destino_padrao !== undefined
        ? alteracoes.destino_padrao
        : ref.destino_padrao,
    cartaoPadraoId:
      alteracoes?.cartao_padrao_id !== undefined
        ? alteracoes.cartao_padrao_id
        : ref.cartao_padrao_id,
    observacao:
      alteracoes?.observacao !== undefined
        ? alteracoes.observacao
        : ref.observacao,
    serieDataTermino:
      alteracoes?.serie_data_termino !== undefined
        ? alteracoes.serie_data_termino
        : ref.serie_data_termino,
  })

  // Números já resolvidos (realizado/cancelado) não são re-inseridos: o
  // passado não se repete no futuro.
  const linhasParaInserir = linhas.filter(
    (linha) => !numerosPreservados.has(linha.parcela_numero),
  )

  return {
    serieId,
    linhasParaInserir,
    idsPrevistoARemover,
    numerosPreservados: [...numerosPreservados],
    novoTotalParcelas,
    novoValorCentavos: valorCentavos,
    novoTotalCentavos: valorCentavos * novoTotalParcelas,
  }
}

// ----------------------------------------------------------------------------
// Linhas prontas para INSERT de uma série RECORRENTE (despesa fixa mensal).
// Mesma política de montarLinhasSerie, mas o valor é o MESMO repetido em cada
// ocorrência (via repetirValorEmOcorrencias) em vez de um total dividido. A
// semana vem de semanaIso(data_prevista); estado nasce 'previsto'. aceita
// serie_data_termino opcional (migration 21), propagado a cada linha como
// metadado informativo do término da recorrência.
// ----------------------------------------------------------------------------
export function montarLinhasRecorrentes(dados) {
  const ocorrencias = repetirValorEmOcorrencias(dados)

  return ocorrencias.map((o) => {
    const { ano, semana } = semanaIso(o.data_prevista)
    const linha = {
      tipo_op: o.tipo_op,
      descricao: o.descricao,
      valor: o.valor,
      data_prevista: o.data_prevista,
      ano_semana: ano,
      semana,
      estado: 'previsto',
      serie_id: o.serie_id,
      parcela_numero: o.parcela_numero,
      total_parcelas: o.total_parcelas,
    }
    if (o.origem !== undefined) linha.origem = o.origem
    if (o.conta_destino_id !== undefined) linha.conta_destino_id = o.conta_destino_id
    if (o.destino_padrao !== undefined) linha.destino_padrao = o.destino_padrao
    if (o.cartao_padrao_id !== undefined) linha.cartao_padrao_id = o.cartao_padrao_id
    if (o.observacao !== undefined) linha.observacao = o.observacao
    if (o.serie_data_termino !== undefined) linha.serie_data_termino = o.serie_data_termino
    return linha
  })
}