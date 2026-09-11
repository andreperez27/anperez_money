// ============================================================================
// RELATÓRIO "RECEBIDO & HORAS" — hook (primeira aba dos Relatórios)
// ============================================================================
// Orquestra as DUAS fontes do relatório e devolve os dados PRONTOS para o
// RelatorioTemplate (cards de resumo, gráfico e lista):
//
//   1) RECEBIDO → planejamentos do período com estado='realizado' e
//      tipo_op='Entrada' (previstos/cancelados entram, a lib filtra). A busca
//      reusa listarPorPeriodo do usePlanejamentos (mesmo índice do módulo).
//   2) EXTRAS → o quanto o valor RECEBIDO passou do FIXO PADRÃO da semana de
//      trabalho (ponto_config.VALOR_FIXO_SEMANA, config.fixoSemana do usePonto
//      — o MESMO valor que o card "Fixo semanal" mostra no Ponto). A lib NÃO
//      consulta mais o fechamento do Ponto (regra 06/09/2026, decisão do
//      André): o extra de cada semana é max(0, Σ recebido − fixo).
//
// A agregação roda na lib PURA calcularRecebidoHoras
// (src/lib/relatorioRecebidoHoras.js), que entrega POR MÊS, POR DATA e POR
// SEMANA. A escolha de qual alimenta o GRÁFICO é centralizada em
// selecionarSerieDoRelatorio (lib): período tipo 'mes' → porData (UMA BARRA
// POR DATA DE RECEBIMENTO, rótulo DD/MM — a mesma granularidade da lista de
// detalhamento logo abaixo); Trimestre/Semestre/Ano/Personalizado → porMes.
// Os dois cards de resumo SOMAM o período inteiro, independente da
// granularidade. Período nulo (Personalizado com faixa inválida) devolve tudo
// vazio → template "Em construção".
// ============================================================================
import { useEffect, useMemo, useState } from 'react'
import { usePlanejamentos } from './usePlanejamentos'
import { usePonto } from './usePonto'
import { definirPeriodo, deslocarPeriodo } from '../lib/periodos'
import { semanaIso } from '../lib/semana'
import {
  agrupamentoPorTipoDePeriodo,
  calcularRecebidoHoras,
  selecionarSerieDoRelatorio,
} from '../lib/relatorioRecebidoHoras'
import { formatoReal } from '../lib/compartilhados'
import { NOME_MES, MES_ABREV } from '../components/planejamento/comum'
import { supabase } from '../lib/supabaseClient'

// Data ISO para rótulo curto pt-BR de semana/mês: '2026-08-03' → '03/08'.
function rotuloCurto(dataISO) {
  const [ano, mes, dia] = String(dataISO).split('-')
  return `${dia}/${mes}`
}

// Data ISO para rótulo LONGO: '2026-08-03' → '03/08/2026'.
function rotuloLongo(dataISO) {
  const [ano, mes, dia] = String(dataISO).split('-')
  return `${dia}/${mes}/${ano}`
}

// Data ISO para rótulo com ano curto (formato da planilha): '2026-08-03' → '03/08/26'.
function rotuloAnoCurto(dataISO) {
  const [ano, mes, dia] = String(dataISO).split('-')
  return `${dia}/${mes}/${ano.slice(2)}`
}

export function useRelatorioRecebidoHoras(periodo) {
  const plano = usePlanejamentos()
  // usePonto alimenta apenas o FIXO SEMANAL (config.fixoSemana, de
  // ponto_config.VALOR_FIXO_SEMANA) — a régua dos extras. Não depende da
  // janela do período (o fixo é global), então monto sem argumentos: só a
  // config é carregada.
  const ponto = usePonto()

  const [itens, setItens] = useState([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)

  // Datas REAIS das movimentações que os lançamentos geraram (Bug 2 de
  // 11/09/2026): o relatório deve usar o dia em que o dinheiro ENTROU de fato
  // (movimentacoes.data) e não a data_prevista (a data em que o pagamento
  // DEVERIA cair — que pode divergir, ex.: Pagamento Semanal previsto 09/09
  // caiu em 10/09). Mapa { [lancamento_id]: 'YYYY-MM-DD' }; recria-se quando os
  // itens mudam.
  const [datasPorLancamento, setDatasPorLancamento] = useState({})

  useEffect(() => {
    let ativo = true
    const ids = (itens ?? [])
      .map((i) => i.lancamento_id)
      .filter((id) => id !== null && id !== undefined)
    if (!ids.length) {
      setDatasPorLancamento({})
      return undefined
    }
    supabase
      .from('movimentacoes')
      .select('id, data')
      .in('id', ids)
      .then(({ data, error }) => {
        if (!ativo) return
        if (error) return
        const mapa = {}
        for (const mov of data ?? []) mapa[mov.id] = mov.data
        setDatasPorLancamento(mapa)
      })
    return () => {
      ativo = false
    }
  }, [itens])

  useEffect(() => {
    let ativo = true
    if (!periodo?.inicio || !periodo?.fim) {
      setItens([])
      setCarregando(false)
      return
    }
    setCarregando(true)
    setErro(null)
    plano
      .listarPorPeriodo(periodo.inicio, periodo.fim, true)
      .then((dados) => {
        if (ativo) setItens(dados ?? [])
      })
      .catch((e) => {
        if (ativo) setErro(e.message)
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })
    return () => {
      ativo = false
    }
    // listarPorPeriodo é recriado a cada render do usePlanejamentos; a lis-
    // tagem só depende da faixa (idempotente), então a dependência são as
    // datas. eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo?.inicio, periodo?.fim])

  const dados = useMemo(() => {
    if (!periodo?.inicio || !periodo?.fim) {
      return { totalRecebido: 0, totalValorHorasExtras: 0, porMes: [], porData: [], porSemana: [], recebimentos: [] }
    }
    return calcularRecebidoHoras({
      planejamentosRealizados: itens,
      fixoSemana: ponto.config.fixoSemana,
      periodo,
      dataRealPorLancamento: datasPorLancamento,
    })
  }, [periodo, itens, ponto.config, datasPorLancamento])

  const apresentacao = useMemo(() => {
    const series = selecionarSerieDoRelatorio(dados, periodo)
    const temData = dados.porMes.length > 0

    // Granularidade do gráfico/lista: Mês abre as BARRAS por DATA de recebi-
    // mento (e a lista detalhada vira UMA linha por pagamento); os demais
    // períodos (Trimestre/Semestre/Ano/Personalizado) abrem por MÊS.
    const porData = agrupamentoPorTipoDePeriodo(periodo?.tipo) === 'data'

    // Média do período (pedido do André): divide SÓ pelos períodos que TÊM
    // lançamento — Mês → nº de PAGAMENTOS realizados (dados.recebimentos: UMA
    // linha por pagamento — correção 11/09/2026, o divisor era porSemana.length
    // e dois pagamentos na mesma semana civil contavam como um só, inflando a
    // média ex.: 4180/1=4180 em vez de 4180/2=2090); demais períodos
    // (Trimestre/Semestre/Ano/Personalizado) → meses com lançamento
    // (dados.porMes). Assim o ano vigente não dilui por 12: em setembro (9º mês
    // com dado) a média anual divide por 9; a semanal divide pelo nº de
    // pagamentos realizados.
    let cardMedia = null
    if (temData) {
      if (porData) {
        const n = dados.recebimentos.length
        if (n > 0) cardMedia = { label: 'Média semanal', valor: formatoReal.format(dados.totalRecebido / n) }
      } else {
        const n = dados.porMes.length
        if (n > 0) cardMedia = { label: 'Média mensal', valor: formatoReal.format(dados.totalRecebido / n) }
      }
    }

    const cards = temData
      ? [
          { label: 'Recebido no período', valor: formatoReal.format(dados.totalRecebido) },
          ...(cardMedia ? [cardMedia] : []),
          { label: 'Extras no período', valor: formatoReal.format(dados.totalValorHorasExtras) },
        ]
      : []

    const grafico = temData
      ? {
          rotulos: series.map((s) => {
            if (porData) return rotuloCurto(s.data)
            return MES_ABREV[Number(s.mes.slice(5, 7)) - 1]
          }),
          valores: series.map((s) => s.recebido),
          extras: series.map((s) => s.valorHorasExtras),
        }
      : { rotulos: [], valores: [], extras: [] }

    const linhas = temData
      ? porData
        ? // UMA LINHA POR PAGAMENTO REALIZADO (regra 06/09/2026): a lista
          // detalhada vem de dados.recebimentos — não da série agregada —,
          // então dois pagamentos que cobrem a MESMA semana de trabalho
          // aparecem cada um com a própria data e o próprio valor, sem fundir.
          // Quatro células por linha: Data do recebimento · referente ao
          // período de trabalho (das colunas gravadas, com fallback na
          // descrição salva — o texto "referente a..." da planilha) · Valor
          // total · Horas extras da fatia (rateio proporcional da semana).
          (dados.recebimentos ?? []).map((it) => {
            let referente = []
            if (it.referente) {
              const ref = semanaIso(it.referente)
              referente = [
                { texto: `referente ao período de ${rotuloAnoCurto(ref.inicio)} a ${rotuloAnoCurto(ref.fim)}` },
              ]
            } else {
              referente = [{ texto: it.descricao || '' }]
            }
            return {
              celulas: [
                { texto: rotuloLongo(it.data) },
                ...referente,
                { texto: formatoReal.format(it.valor), cor: '#e5e7eb', forte: true },
                { texto: formatoReal.format(it.valorHorasExtras), cor: '#F59E0B', forte: true },
              ],
            }
          })
        : series.map((s) => {
            const valor = `${formatoReal.format(s.recebido)} · ${formatoReal.format(s.valorHorasExtras)}`
            const mes = Number(s.mes.slice(5, 7))
            const ano = s.mes.slice(0, 4)
            return { label: `${NOME_MES[mes - 1]} / ${ano}`, valor }
          })
      : []

    return { cards, grafico, linhas }
  }, [dados, periodo])

  return {
    carregando,
    erro,
    temData: dados.porMes.length > 0,
    ...apresentacao,
  }
}