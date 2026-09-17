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
  const [caixinhaMovs, setCaixinhaMovs] = useState([])
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
      supabase.from('caixinhas').select('id, nome, saldo, ativa, conta_id, criado_em').eq('ativa', true),
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
      supabase
        .from('caixinha_movimentacoes')
        .select('id, caixinha_id, data, valor, tipo')
        .gte('data', coberturaMinima)
        .lte('data', hoje)
        .order('data', { ascending: true }),
    ])
      .then(([contasRes, caixRes, movsRes, histRes, caixMovRes]) => {
        if (!ativo) return
        if (contasRes.error) throw new Error(contasRes.error.message)
        if (caixRes.error) throw new Error(caixRes.error.message)
        if (movsRes.error) throw new Error(movsRes.error.message)
        if (histRes.error) throw new Error(histRes.error.message)
        if (caixMovRes.error) throw new Error(caixMovRes.error.message)
        setContas(contasRes.data ?? [])
        setCaixinhas(caixRes.data ?? [])
        setMovimentacoes(movsRes.data ?? [])
        setHistorico(histRes.data ?? [])
        setCaixinhaMovs(caixMovRes.data ?? [])
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
      caixinhaMovs,
      periodo,
      coberturaMinima,
    })
  }, [contas, caixinhas, movimentacoes, historico, caixinhaMovs, periodo])

  const apresentacao = useMemo(() => {
    if (dados.semDados) {
      return {
        cards: [],
        grafico: null,
        linhas: [],
        aviso: dados.motivoSemDados,
      }
    }
    const temData = dados.pontos.length > 0 && dados.patrimonioAtual !== null

    if (!temData) {
      return { cards: [], grafico: null, linhas: [] }
    }

    const corPositiva = '#22C55E'
    const corNegativa = '#EF4444'
    const corPatrimonio = '#42A5F5'

    const variacao = dados.variacao ?? 0
    const variacaoPct = dados.variacaoPercentual
    const hojeLimite = new Date().toISOString().slice(0, 10)
    const fimEfetivo = dados.pontos[dados.pontos.length - 1]?.data || periodo?.fim

    // Resumo simplificado: início / fim (ou hoje) / variação
    const cards = [
      {
        label: `Patrimônio em ${rotuloLongo(dados.pontos[0].data)}`,
        valor: formatoReal.format(dados.patrimonioInicial),
        cor: corPatrimonio,
      },
      {
        label: `Patrimônio em ${rotuloLongo(fimEfetivo)}`,
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

    // Gráfico só para Trimestre e Ano (mês a mês). Semana/Mês/Personalizado
    // ficam só com o resumo acima, sem gráfico.
    const temGrafico = dados.granularidade !== null && dados.pontos.length > 2
    const grafico = temGrafico
      ? {
          rotulos: dados.pontos.map((p) => rotuloData(p.data, dados.granularidade)),
          valores: dados.pontos.map((p) => p.patrimonio),
        }
      : null

    const linhas = dados.pontos.map((p) => ({
      label: rotuloLongo(p.data),
      valor: formatoReal.format(p.patrimonio),
    }))

    const avisoAjuste = dados.inicioAjustado
      ? `Início ajustado para ${rotuloLongo(dados.inicioAjustado)} por falta de dado anterior a junho/2026`
      : null

    return { cards, grafico, linhas, avisoAjuste, semDados: dados.semDados, motivoSemDados: dados.motivoSemDados }
  }, [dados, periodo])

  return {
    carregando,
    erro,
    temData: dados.pontos.length > 0,
    pontos: dados.pontos,
    patrimonioAtual: dados.patrimonioAtual,
    ...apresentacao,
  }
}
