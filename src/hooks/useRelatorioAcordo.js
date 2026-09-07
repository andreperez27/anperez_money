// ============================================================================
// RELATÓRIO "ACORDO TRABALHISTA" — hook (aba dos Relatórios)
// ============================================================================
// Busca os planejamentos do período (mesma listarPorPeriodo do
// usePlanejamentos, com incluirHistorico=true para trazer as origens do
// histórico) e delega à lib PURA calcularRecebidoAcordo
// (src/lib/relatorioAcordo.js), que filtra origem='historico_acordo' e entrega
// os números. Pega a série do gráfico pela MESMA regra centralizada do
// "Recebido & horas": Mês → porData; Trimestre/Semestre/Ano/Personalizado →
// porMes. Cards: total recebido no período + total de depósitos. Lista: UMA
// LINHA POR DEPÓSITO (data + valor).
// ============================================================================
import { useEffect, useMemo, useState } from 'react'
import { usePlanejamentos } from './usePlanejamentos'
import { agrupamentoPorTipoDePeriodo } from '../lib/relatorioRecebidoHoras'
import { calcularRecebidoAcordo } from '../lib/relatorioAcordo'
import { formatoReal } from '../lib/compartilhados'
import { MES_ABREV } from '../components/planejamento/comum'

function rotuloCurto(dataISO) {
  const [ano, mes, dia] = String(dataISO).split('-')
  return `${dia}/${mes}`
}

function rotuloLongo(dataISO) {
  const [ano, mes, dia] = String(dataISO).split('-')
  return `${dia}/${mes}/${ano}`
}

export function useRelatorioAcordo(periodo) {
  const plano = usePlanejamentos()

  const [itens, setItens] = useState([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    let ativo = true
    if (!periodo?.inicio || !periodo?.fim) {
      setItens([])
      setCarregando(false)
      return
    }
    setCarregando(true)
    setErro(null)
    // incluirHistorico=true: o histórico da planilha entra para a lista;
    // a lib depois isola somente origem 'historico_acordo'.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo?.inicio, periodo?.fim])

  const dados = useMemo(() => {
    if (!periodo?.inicio || !periodo?.fim) {
      return { totalRecebido: 0, depositos: [], porMes: [], porData: [] }
    }
    return calcularRecebidoAcordo({ planejamentos: itens, periodo })
  }, [periodo, itens])

  const apresentacao = useMemo(() => {
    const series = agrupamentoPorTipoDePeriodo(periodo?.tipo) === 'data'
      ? dados.porData
      : dados.porMes
    const temData = dados.depositos.length > 0

    const cards = temData
      ? [
          { label: 'Total recebido no acordo', valor: formatoReal.format(dados.totalRecebido) },
          { label: 'Depósitos no período', valor: String(dados.depositos.length) },
        ]
      : []

    const grafico = temData
      ? {
          rotulos: series.map((s) =>
            agrupamentoPorTipoDePeriodo(periodo?.tipo) === 'data'
              ? rotuloCurto(s.data)
              : MES_ABREV[Number(s.mes.slice(5, 7)) - 1],
          ),
          valores: series.map((s) => s.recebido),
        }
      : { rotulos: [], valores: [] }

    const linhas = temData
      ? dados.depositos.map((d) => ({
          celulas: [
            { texto: rotuloLongo(d.data) },
            { texto: d.descricao || '' },
            { texto: formatoReal.format(d.valor), cor: '#e5e7eb', forte: true },
          ],
        }))
      : []

    return { cards, grafico, linhas }
  }, [dados, periodo])

  return {
    carregando,
    erro,
    temData: dados.depositos.length > 0,
    ...apresentacao,
  }
}