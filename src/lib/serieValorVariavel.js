// ============================================================================
// SÉRIES DE VALOR VARIÁVEL — atualização automática da projeção (09/09/2026)
// ============================================================================
// Lib PURA (sem React/Supabase/relógio) que materializa a regra definitiva de
// valor variável aplicada a SÉRIES recorrentes inteiras:
//
//   • identificarRegraValorVariavel    → qual série é "por média" (condomínio
//                                        ou energia) e merece reprojeção;
//   • extrairHistoricosVariaveis        → Gás/Água reais a partir das
//                                        observações dos condomínios realizados;
//   • calcularReprojecaoValorVariavel   → recalcula SOMENTE as ocorrências
//                                        'previsto' de uma série (passado
//                                        realizado/cancelado imutável).
//
// MOTIVAÇÃO: hoje as séries são ESTÁTICAS — o valor de cada ocorrência futura
// é congelado na criação. Ao REALIZAR um lançamento de uma série por média
// (ex.: lançar o condomínio de outubro, ou o boleto de energia de setembro),
// a projeção dos meses seguintes NÃO se reajusta sozinha. Esta lib + o hook
// (usePlanejamentos) fazem a reprojeção no MESMO ciclo de mutação/recarga da
// página (realizar → atualizar → versaoRecarga do saldo projetado), sem criar
// um segundo caminho de atualização paralelo.
//
// Identificação por convenção (sem schema novo): as séries por média nascem
// com contrapartidas reconhecíveis nas próprias linhas:
//   • condomínio → descricao começa com "Condomínio" e observação no formato
//     de montarObservacaoCondominio (linhas com códigos fixos + 1010/1052);
//   • energia    → observação com o marcador "projeção pela regra de valor
//     variável" (gravado por gerar_serie_energia.mjs) ou descricao Enel/
//     energia.
// ============================================================================

import { projetarValorVariavel } from './mediaMovelCalc.js'
import { calcularTotalCondominio, montarObservacaoCondominio } from './despesaRecorrenteCalc.js'

// Marcador gravado na observação das séries de energia (ver
// scripts/gerar_serie_energia.mjs). Qualquer série variável nova deve seguir
// a mesma convenção para entrar na atualização automática.
export const MARCADOR_ENERGIA = 'projeção pela regra de valor variável'

// ----------------------------------------------------------------------------
// Lê o valor em REAIS de uma linha da observação do condomínio que começa com
// o código procurado (ex.: "1010 Consumo de Gás R$ 90,00" → 90). Devolve null
// quando a linha não existe ou o valor não é legível. Mantido aqui para ser a
// única implementação (formulário do condomínio + scripts de série).
// ----------------------------------------------------------------------------
export function parseValorObservacao(observacao, cod) {
  if (!observacao) return null
  const linha = String(observacao)
    .split('\n')
    .find((l) => {
      const t = l.trim()
      return t.startsWith(`${cod} `) || t.startsWith(`${cod}\t`)
    })
  if (!linha) return null
  const m = linha.match(/R\$\s*([\d.,]+)/)
  if (!m) return null
  const n = Number(m[1].replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

// ----------------------------------------------------------------------------
// Identifica se uma linha pertence a uma SÉRIE de valor variável (projetada
// pela regra de média). Devolve 'condominio' | 'energia' | null. Exige
// serie_id (avulsas e séries fixas nunca entram na reprojeção automática).
// ----------------------------------------------------------------------------
export function identificarRegraValorVariavel(linha) {
  if (!linha || !linha.serie_id) return null
  const obs = String(linha.observacao ?? '')
  if (obs.includes(MARCADOR_ENERGIA)) return 'energia'
  const desc = String(linha.descricao ?? '').toLowerCase()
  if (desc.startsWith('condomínio') || desc.startsWith('condominio')) return 'condominio'
  if (desc.includes('enel') || desc.includes('energia') || desc.includes('eletropaulo')) {
    return 'energia'
  }
  return null
}

// ----------------------------------------------------------------------------
// Extrai os históricos REAIS de Gás (1010) e Água (1052) das observações de
// condomínios já realizados. A entrada deve vir do MAIS RECENTE para o MAIS
// ANTIGO (mesma query do gerador); um valor por mês civil (dedupe); a saída é
// em ordem CRONOLÓGICA (a regra de média lê os últimos N da ponta final).
// ----------------------------------------------------------------------------
export function extrairHistoricosVariaveis(realizados, { limiteMeses = 36 } = {}) {
  const gas = []
  const agua = []
  const mesesVistos = new Set()
  for (const r of realizados ?? []) {
    if (!r.data_prevista) continue
    const chaveMes = r.data_prevista.slice(0, 7)
    if (mesesVistos.has(chaveMes)) continue
    mesesVistos.add(chaveMes)
    const g = parseValorObservacao(r.observacao, '1010')
    const a = parseValorObservacao(r.observacao, '1052')
    if (g !== null) gas.push(g)
    if (a !== null) agua.push(a)
    if (mesesVistos.size >= limiteMeses) break
  }
  gas.reverse()
  agua.reverse()
  return { gas, agua }
}

// ----------------------------------------------------------------------------
// Reconstrói a observação de uma série de ENERGIA com a projeção atual (mesma
// estrutura do gerar_serie_energia.mjs). `reais` são os valores usados no
// cálculo (últimos da janela) e `projecao` o valor projetado — com 3+ reais é
// a média dos 3 últimos; com menos, repete o último (regra definitiva).
// ----------------------------------------------------------------------------
export function montarObservacaoEnergia({ reais = [], projecao }) {
  const lista = reais.map((v) => Number(v).toFixed(2)).join(' · ')
  const qtdReais = reais.length === 1 ? '1 real' : `${reais.length} reais`
  const linhaMetodo =
    reais.length >= 3
      ? `  média dos ${reais.length} últimos reais: ${lista} = ${Number(projecao).toFixed(2)}`
      : `  ${qtdReais} disponível(is): ${lista} = ${Number(projecao).toFixed(2)} (regra: repete o último real)`
  return [
    'Conta de energia (Enel) — projeção pela regra de valor variável:',
    linhaMetodo,
    '  a média desliza conforme novos boletos reais forem lançados.',
  ].join('\n')
}

// ----------------------------------------------------------------------------
// NÚCLEO DA REPROJEÇÃO: recalcula o valor (e a observação) SOMENTE das
// ocorrências 'previsto' da série. Realizado/cancelado NUNCA entram (imutável).
//
//   • condominio → para cada mês previsto, soma os itens fixos VIGENTES no
//     mês + o Gás/Água projetados pela regra definitiva (média dos 3 últimos
//     reais; < 3 repete o último; sem histórico = 0);
//   • energia    → projeta pela média dos últimos N reais de energia da conta;
//     sem nenhum real ainda (série recém-criada) mantém a projeção atual.
//
// Devolve { updates: [{ id, valor, observacao }] } — só linhas cujo valor OU
// observação realmente mudou (idempotente; re-executar não reescreve nada).
// ----------------------------------------------------------------------------
export function calcularReprojecaoValorVariavel({
  linhas = [],
  tipo,
  itensFixos = [],
  historicoGas = [],
  historicoAgua = [],
  historicoValor = [],
}) {
  const updates = []
  for (const linha of linhas) {
    if (!linha || linha.estado !== 'previsto') continue

    let novoValor
    let novaObservacao
    if (tipo === 'energia') {
      const projecao = projetarValorVariavel({ historico: historicoValor })
      if (projecao === null) continue // sem reais: preserva a projeção gravada
      novoValor = projecao
      novaObservacao = montarObservacaoEnergia({
        reais: historicoValor.slice(-3),
        projecao,
      })
    } else {
      const gas = projetarValorVariavel({ historico: historicoGas }) ?? 0
      const agua = projetarValorVariavel({ historico: historicoAgua }) ?? 0
      const mes = String(linha.data_prevista).slice(0, 7)
      const { total, detalhamento } = calcularTotalCondominio({
        itens: itensFixos,
        mes,
        gas,
        agua,
      })
      novoValor = total
      novaObservacao = montarObservacaoCondominio(detalhamento)
    }

    const atual = Number(linha.valor)
    const mudou =
      Math.abs(atual - novoValor) > 1e-9 || (linha.observacao ?? '') !== novaObservacao
    if (mudou) {
      updates.push({ id: linha.id, valor: novoValor, observacao: novaObservacao })
    }
  }
  return { updates }
}