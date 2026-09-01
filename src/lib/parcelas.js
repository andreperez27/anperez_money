// ============================================================================
// PARCELAS — funções PURAS de matemática e datas para séries de planejamento
// ============================================================================
// Responsabilidade exclusiva desta lib (ETAPA 06/E5-C):
//   1. dividir um valor monetário em parcelas EXATAS (centavos inteiros);
//   2. calcular a data de cada parcela (ancoragem + clamp mensal);
//   3. montar as ocorrências de uma série (dados prontos para o hook gravar).
//
// O que esta lib NÃO conhece: React, Supabase, hooks, semanas ISO. A dupla
// ano_semana/semana continua nascendo SOMENTE no usePlanejamentos via
// src/lib/semana.js (fonte única desde a E1) — aqui não se chama semanaIso.
//
// Dinheiro vive em CENTAVOS INTEIROS (mesma convenção de extratoCalc.js):
// nenhum float participa das decisões de valor. O banco segue numeric(12,2).
//
// Regras aprovadas na modelagem E5-A:
//   D1 — o resto da divisão vai às PRIMEIRAS parcelas, 1 centavo cada;
//   D2 — datas ancoradas no dia da 1ª parcela com clamp no fim do mês:
//        31/01 → 28/02 → 31/03 (o dia original permanece a intenção).
// ============================================================================

const TIPOS_OP = ['Entrada', 'Saida']

// Lê e valida uma data civil estrita ('YYYY-MM-DD'), mesmo critério de
// semana.js: formato exato, mês/dia reais no calendário gregoriano.
// Devolve { ano, mes, dia }. Lança Error com mensagem clara.
function lerDataCivil(dataISO) {
  if (typeof dataISO !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dataISO)) {
    throw new Error(`Data inválida ("${dataISO}"): use o formato YYYY-MM-DD.`)
  }
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  const ts = Date.UTC(ano, mes - 1, dia)
  const volta = new Date(ts)
  if (
    volta.getUTCFullYear() !== ano ||
    volta.getUTCMonth() !== mes - 1 ||
    volta.getUTCDate() !== dia
  ) {
    throw new Error(`Data inexistente no calendário ("${dataISO}").`)
  }
  return { ano, mes, dia }
}

// Timestamp UTC -> 'YYYY-MM-DD'.
function isoDe(ts) {
  return new Date(ts).toISOString().slice(0, 10)
}

// ----------------------------------------------------------------------------
// 1. DIVISÃO — primeiras parcelas recebem o restante dos centavos (D1)
// ----------------------------------------------------------------------------
// Garantia: soma das parcelas === totalCentavos, sempre, sem float.
// Rejeita totais menores que a quantidade: alguma parcela sairia com 0 centavo
// e o banco exige valor > 0 (CHECK da migration 08).
export function dividirValorEmParcelas(totalCentavos, quantidade) {
  if (!Number.isInteger(totalCentavos) || totalCentavos <= 0) {
    throw new Error(
      `Total inválido (${totalCentavos}): informe centavos como inteiro positivo.`,
    )
  }
  if (!Number.isInteger(quantidade) || quantidade < 1) {
    throw new Error(`Quantidade de parcelas inválida (${quantidade}).`)
  }
  if (totalCentavos < quantidade) {
    throw new Error(
      `Total de ${totalCentavos} centavo(s) não cobre ${quantidade} parcela(s): ` +
        'alguma parcela ficaria com R$ 0,00.',
    )
  }

  const base = Math.floor(totalCentavos / quantidade)
  const resto = totalCentavos % quantidade

  const parcelas = new Array(quantidade)
  for (let i = 0; i < quantidade; i += 1) {
    parcelas[i] = i < resto ? base + 1 : base
  }
  return parcelas
}

// ----------------------------------------------------------------------------
// 2. PERIODICIDADE VÁLIDA — 'mensal' (padrão) ou 'semanal'
// ----------------------------------------------------------------------------
const PERIODICIDADES = ['mensal', 'semanal']

function validarPeriodicidade(periodicidade) {
  if (periodicidade === undefined || periodicidade === null) return 'mensal'
  if (!PERIODICIDADES.includes(periodicidade)) {
    throw new Error(
      `Periodicidade inválida ("${periodicidade}"): use mensal ou semanal.`,
    )
  }
  return periodicidade
}

// ----------------------------------------------------------------------------
// 2. DATA DA PARCELA — ancorada no dia original, clamp no fim do mês (D2)
// ----------------------------------------------------------------------------
// Parcela 1 devolve a própria dataPrimeiraParcela. As demais avançam MESES
// inteiros por componentes UTC; quando o mês-alvo não tem o dia âncora,
// usa-se o ÚLTIMO dia dele — sem perder a âncora para os meses seguintes.
//
// Periodicidade 'semanal': parcela N = dataPrimeiraISO + 7*(N-1) dias
// corridos. Não há clamp de fim de mês (não se aplica a semanas). O
// resultado continua um dia CIVIL válido via aritmética UTC.
export function dataDaParcela(dataPrimeiraISO, numeroParcela, periodicidade = 'mensal') {
  if (!Number.isInteger(numeroParcela) || numeroParcela < 1) {
    throw new Error(`Número da parcela inválido (${numeroParcela}).`)
  }
  const { ano, mes, dia } = lerDataCivil(dataPrimeiraISO)
  const per = validarPeriodicidade(periodicidade)

  if (per === 'semanal') {
    const ts0 = Date.UTC(ano, mes - 1, dia)
    return isoDe(ts0 + (numeroParcela - 1) * 7 * 86_400_000)
  }

  const indiceMes = mes - 1 + (numeroParcela - 1)
  const anoAlvo = ano + Math.floor(indiceMes / 12)
  const mesAlvo = (indiceMes % 12) + 1

  // Dia 0 do mês seguinte = último dia do mês alvo (truque UTC determinístico)
  const ultimoDia = new Date(Date.UTC(anoAlvo, mesAlvo, 0)).getUTCDate()
  const diaEfetivo = Math.min(dia, ultimoDia)

  return isoDe(Date.UTC(anoAlvo, mesAlvo - 1, diaEfetivo))
}

// ----------------------------------------------------------------------------
// 3. GERAÇÃO DA SÉRIE — dados prontos para o hook inserir
// ----------------------------------------------------------------------------
// Devolve um array com UMA ocorrência por parcela (snake_case igual às
// colunas da tabela). NÃO insere nada, NÃO calcula semana, NÃO gera
// lancamento_id — isso é do usePlanejamentos/banco.
export function gerarOcorrenciasDaSerie(dados) {
  const {
    serieId,
    tipoOp,
    descricao,
    totalCentavos,
    totalParcelas,
    dataPrimeiraParcela,
    periodicidade,
    origem,
    contaDestinoId,
    destinoPadrao,
    cartaoPadraoId,
    observacao,
  } = dados ?? {}

  if (typeof serieId !== 'string' || !serieId.trim()) {
    throw new Error('serieId é obrigatório.')
  }
  if (!TIPOS_OP.includes(tipoOp)) {
    throw new Error('tipoOp deve ser Entrada ou Saida.')
  }
  if (!descricao || !descricao.trim()) {
    throw new Error('Informe a descrição.')
  }

  const centavosPorParcela = dividirValorEmParcelas(totalCentavos, totalParcelas)

  const ocorrencias = centavosPorParcela.map((centavos, indice) => {
    const numero = indice + 1
    const ocorrencia = {
      serie_id: serieId,
      parcela_numero: numero,
      total_parcelas: totalParcelas,
      tipo_op: tipoOp,
      descricao: descricao.trim(),
      // Centavos -> reais só NA SAÍDA (exibição/payload); o cálculo foi todo
      // em inteiro. Ex.: 15000 -> 150 (representação exata até 2 decimais).
      valor: centavos / 100,
      data_prevista: dataDaParcela(dataPrimeiraParcela, numero, periodicidade),
    }
    if (origem !== undefined) ocorrencia.origem = origem
    if (contaDestinoId !== undefined && contaDestinoId !== null && contaDestinoId !== '') {
      ocorrencia.conta_destino_id = contaDestinoId
    }
    if (destinoPadrao !== undefined) ocorrencia.destino_padrao = destinoPadrao
    if (cartaoPadraoId !== undefined && cartaoPadraoId !== null && cartaoPadraoId !== '') {
      ocorrencia.cartao_padrao_id = cartaoPadraoId
    }
    if (observacao !== undefined && observacao !== null && observacao !== '') {
      ocorrencia.observacao = observacao
    }
    return ocorrencia
  })

  return ocorrencias
}

// ----------------------------------------------------------------------------
// 4. RECORRÊNCIA — MESMO valor repetido em todas as ocorrências
// ----------------------------------------------------------------------------
// Para despesas fixas mensais (DAS-MEI, assinaturas, condomínio com valor
// calculado no 1º mês), a série NÃO divide um total: repete o valor do mês
// inicial em cada parcela. Compartilha toda a aritmética de datas/dia ãncora
// com gerarOcorrenciasDaSerie (dataDaParcela, clamp de fim de mês D2); o que
// muda é apenas a origem do valor (único, repetido) e a leitura opcional de
// serie_data_termino (metadado informativo da migration 21, propagado a cada
// linha — nunca usado no cálculo, sempre derivado da UI).
export function repetirValorEmOcorrencias(dados) {
  const {
    serieId,
    tipoOp,
    descricao,
    valorCentavos,
    totalParcelas,
    dataPrimeiraParcela,
    origem,
    contaDestinoId,
    destinoPadrao,
    cartaoPadraoId,
    observacao,
    serieDataTermino,
  } = dados ?? {}

  if (typeof serieId !== 'string' || !serieId.trim()) {
    throw new Error('serieId é obrigatório.')
  }
  if (!TIPOS_OP.includes(tipoOp)) {
    throw new Error('tipoOp deve ser Entrada ou Saida.')
  }
  if (!descricao || !descricao.trim()) {
    throw new Error('Informe a descrição.')
  }
  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) {
    throw new Error(
      `Valor inválido (${valorCentavos}): informe centavos como inteiro positivo.`,
    )
  }
  if (!Number.isInteger(totalParcelas) || totalParcelas < 1) {
    throw new Error(`Quantidade de parcelas inválida (${totalParcelas}).`)
  }

  const ocorrencias = []
  for (let numero = 1; numero <= totalParcelas; numero += 1) {
    const ocorrencia = {
      serie_id: serieId,
      parcela_numero: numero,
      total_parcelas: totalParcelas,
      tipo_op: tipoOp,
      descricao: descricao.trim(),
      valor: valorCentavos / 100,
      data_prevista: dataDaParcela(dataPrimeiraParcela, numero, 'mensal'),
    }
    if (origem !== undefined) ocorrencia.origem = origem
    if (contaDestinoId !== undefined && contaDestinoId !== null && contaDestinoId !== '') {
      ocorrencia.conta_destino_id = contaDestinoId
    }
    if (destinoPadrao !== undefined) ocorrencia.destino_padrao = destinoPadrao
    if (cartaoPadraoId !== undefined && cartaoPadraoId !== null && cartaoPadraoId !== '') {
      ocorrencia.cartao_padrao_id = cartaoPadraoId
    }
    if (observacao !== undefined && observacao !== null && observacao !== '') {
      ocorrencia.observacao = observacao
    }
    if (serieDataTermino !== undefined && serieDataTermino !== null && serieDataTermino !== '') {
      ocorrencia.serie_data_termino = serieDataTermino
    }
    ocorrencias.push(ocorrencia)
  }

  return ocorrencias
}
