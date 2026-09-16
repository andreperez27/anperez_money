// ============================================================================
// RELATÓRIO PATRIMÔNIO — hook (aba dos Relatórios)
// ============================================================================
// Patrimônio total = saldo das contas ativas + saldo das caixinhas ativas
// (definição única em src/lib/patrimonioCalc.js). A evolução é o replay
// cronológico dos lançamentos REALIZADOS em conta + caixinhas constantes
// (limitação assumida: caixinhas sem histórico retroativo; sinalizada na lib).
// Usa o mesmo SeletorPeriodoRelatorio das outras abas e o mesmo
// RelatorioTemplate (resumo → gráfico → lista).
// ============================================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { calcularEvolucaoPatrimonio } from '../lib/patrimonioCalc'
import { formatoReal } from '../lib/compartilhados'
import { adicionarDiasISO } from '../lib/saldoProjetado'

const COBERTURA_DIAS = 400

function rotuloData(dataISO, granularidade) {
  const [ano, mes, dia] = String(dataISO).split('-')
  if (granularidade === 'mes') {
    const MES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
    return `${MES_ABREV[Number(mes) - 1]}/${ano.slice(2)}`
  }
  if (granularidade === 'semana') {
    return `${dia}/${mes}`
  }
  return `${dia}/${mes}`
}

function rotuloLongo(dataISO) {
  const [ano, mes, dia] = String(dataISO).split('-')
  return `${dia}/${mes}/${ano}`
}

export function useRelatorioPatrimonio(periodo) {
  const [contas, setContas] = useState([])
  const [caixinhas, setCaixinhas] = useState([])
  const [movimentacoes, setMovimentacoes] = useState([])
  const [historico, setHistorico] = useState([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    let ativo = true
    if (!periodo?.inicio || !periodo?.fim) {
      setCarregando(false)
      return
    }
    setCarregando(true)
    setErro(null)

    const hoje = new Date().toISOString().slice(0, 10)
    const coberturaMinima = adicionarDiasISO(hoje, -COBERTURA_DIAS)

    Promise.all([
      supabase.from('contas').select('id, nome, saldo_atual, ativa').eq('ativa', true),
      supabase.from('caixinhas').select('id, nome, saldo, ativa, conta_id').eq('ativa', true),
      supabase
        .from('movimentacoes')
        .select('id, conta_id, data, valor, tipo_op, categoria, transferencia_id')
        .gte('data', coberturaMinima)
        .lte('data', hoje)
        .order('data', { ascending: true }),
      supabase
        .from('planejamentos')
        .select('id, data_prevista, valor, tipo_op, estado, origem')
        .in('origem', ['historico_planilha', 'historico_acordo', 'historico_outros'])
        .eq('estado', 'realizado')
        .gte('data_prevista', coberturaMinima)
        .lte('data_prevista', hoje)
        .order('data_prevista', { ascending: true }),
    ])
      .then(([contasRes, caixRes, movsRes, histRes]) => {
        if (!ativo) return
        if (contasRes.error) throw new Error(contasRes.error.message)
        if (caixRes.error) throw new Error(caixRes.error.message)
        if (movsRes.error) throw new Error(movsRes.error.message)
        if (histRes.error) throw new Error(histRes.error.message)
        setContas(contasRes.data ?? [])
        setCaixinhas(caixRes.data ?? [])
        setMovimentacoes(movsRes.data ?? [])
        setHistorico(histRes.data ?? [])
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
  }, [periodo?.inicio, periodo?.fim])

  const dados = useMemo(() => {
    if (!periodo?.inicio || !periodo?.fim) {
      return { pontos: [], patrimonioAtual: null, patrimonioInicial: null, variacao: null, variacaoPercentual: null, granularidade: 'dia' }
    }
    const hoje = new Date().toISOString().slice(0, 10)
    const coberturaMinima = adicionarDiasISO(hoje, -COBERTURA_DIAS)
    return calcularEvolucaoPatrimonio({
      contas,
      caixinhas,
      movimentacoes,
      historico,
      periodo,
      coberturaMinima,
    })
  }, [contas, caixinhas, movimentacoes, historico, periodo])

  const apresentacao = useMemo(() => {
    const temData = dados.pontos.length > 0 && dados.patrimonioAtual !== null

    if (!temData) {
      return { cards: [], grafico: null, linhas: [] }
    }

    const corPositiva = '#22C55E'
    const corNegativa = '#EF4444'
    const corPatrimonio = '#42A5F5'

    const variacao = dados.variacao ?? 0
    const variacaoPct = dados.variacaoPercentual

    const cards = [
      {
        label: 'Patrimônio atual',
        valor: formatoReal.format(dados.patrimonioAtual),
        cor: corPatrimonio,
      },
      {
        label: 'Variação no período',
        valor: `${variacao >= 0 ? '+' : '−'} ${formatoReal.format(Math.abs(variacao))}`,
        cor: variacao >= 0 ? corPositiva : corNegativa,
      },
      ...(variacaoPct !== null
        ? [
            {
              label: 'Variação %',
              valor: `${variacaoPct >= 0 ? '+' : ''}${variacaoPct.toFixed(2).replace('.', ',')}%`,
              cor: variacaoPct >= 0 ? corPositiva : corNegativa,
            },
          ]
        : []),
    ]

    const grafico = {
      rotulos: dados.pontos.map((p) => rotuloData(p.data, dados.granularidade)),
      valores: dados.pontos.map((p) => p.patrimonio),
    }

    const linhas = dados.pontos.map((p) => ({
      label: rotuloLongo(p.data),
      valor: formatoReal.format(p.patrimonio),
    }))

    return { cards, grafico, linhas }
  }, [dados])

  return {
    carregando,
    erro,
    temData: dados.pontos.length > 0,
    pontos: dados.pontos,
    patrimonioAtual: dados.patrimonioAtual,
    ...apresentacao,
  }
}
