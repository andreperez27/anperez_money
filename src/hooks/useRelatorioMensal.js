// ============================================================================
// RELATÓRIO MENSAL — hook (aba "Relatório Mensal" dos Relatórios + PDF)
// ============================================================================
// Reúne TUDO que o PDF mensal precisa (fluxo, horas, recebimentos, gasto por
// categoria, faturas reais, saldos de contas + caixinhas reconstruídas) e
// devolve um objeto `dados` pronto para src/lib/gerarPdfRelatorioMensal.js.
// Não renderiza nada — só busca e calcula (mesma filosofia dos outros hooks).
// ============================================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { hoje } from '../lib/compartilhados'
import { adicionarDiasISO } from '../lib/saldoProjetado'
import { calcularEntradasDespesas } from '../lib/relatorioEntradasDespesas'
import { calcularGastoPorCategoria, analisarCategoria, calcularSaldosFinais } from '../lib/relatorioPdf'
import { calcularRecebidoHoras } from '../lib/relatorioRecebidoHoras'
import { espelhoControlePonto } from '../lib/controlePontoCalc'
import { vencimentoRealISO } from '../lib/diaUtil'

const COBERTURA_PASSADO_DIAS = 400

function sinalCaixinha(tipo) {
  return tipo === 'resgatar' || tipo === 'taxa' ? -1 : 1
}

export function useRelatorioMensal(periodo) {
  const [dados, setDados] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    let ativo = true
    if (!periodo?.inicio || !periodo?.fim) {
      setDados(null)
      setCarregando(false)
      return undefined
    }
    setCarregando(true)
    setErro(null)

    const hojeISO = hoje()
    const coberturaMinima = adicionarDiasISO(hojeISO, -COBERTURA_PASSADO_DIAS)
    const mesRef = String(periodo.inicio).slice(0, 7)

    Promise.all([
      // movimentações amplas (cobertura para saldos) — ordenadas por data
      supabase
        .from('movimentacoes')
        .select('*')
        .gte('data', coberturaMinima)
        .lte('data', hojeISO)
        .order('data', { ascending: true }),
      supabase.from('contas').select('*'),
      supabase.from('caixinhas').select('*').eq('ativa', true),
      supabase
        .from('caixinha_movimentacoes')
        .select('caixinha_id, tipo, valor, data')
        .gte('data', coberturaMinima)
        .lte('data', hojeISO)
        .order('data', { ascending: true }),
      supabase
        .from('compras')
        .select('*')
        .eq('ativa', true)
        .gte('data', periodo.inicio)
        .lte('data', periodo.fim),
      supabase.from('v_faturas').select('*').eq('mes_fatura', mesRef),
      supabase.from('cartoes').select('*'),
      supabase
        .from('planejamentos')
        .select('*')
        .gte('data_prevista', periodo.inicio)
        .lte('data_prevista', periodo.fim)
        .order('data_prevista', { ascending: true })
        .order('parcela_numero', { ascending: true }),
      // ponto
      supabase.from('ponto_excecoes').select('*').gte('data', periodo.inicio).lte('data', periodo.fim).order('data'),
      supabase.from('ponto_excecoes').select('*').order('data').limit(5000),
      supabase.from('ponto_feriados').select('data, nome').order('data'),
      supabase.from('ponto_config').select('chave, valor'),
      supabase.from('ponto_ferias').select('*').order('data_inicio'),
    ])
      .then(([
        movsRes, contasRes, caixRes, caixMovRes, comprasRes, faturasRes,
        cartoesRes, planRes, excRes, todasRes, ferRes, cfgRes, fasRes,
      ]) => {
        if (!ativo) return
        for (const r of [movsRes, contasRes, caixRes, caixMovRes, comprasRes, faturasRes, cartoesRes, planRes, excRes, todasRes, ferRes, cfgRes, fasRes]) {
          if (r?.error) throw new Error(r.error.message)
        }
        const movsWide = movsRes.data ?? []
        const movsPeriodo = movsWide.filter((m) => m.data >= periodo.inicio && m.data <= periodo.fim)
        const contas = contasRes.data ?? []
        const caixinhas = caixRes.data ?? []
        const caixinhaMovs = caixMovRes.data ?? []
        const compras = comprasRes.data ?? []
        const faturasReais = faturasRes.data ?? []
        const cartoes = cartoesRes.data ?? []
        const planejamentos = planRes.data ?? []

        // Ponto
        const cfgMapa = {}
        for (const l of cfgRes.data ?? []) cfgMapa[l.chave] = Number(l.valor)
        const pontoConfigFmt = {
          fixoSemana: cfgMapa.VALOR_FIXO_SEMANA ?? 1650,
          temposCarga: {
            utilEntrada: cfgMapa.CARGA_UTIL_ENTRADA ?? 1230,
            utilSaida: cfgMapa.CARGA_UTIL_SAIDA ?? 180,
            sabadoEntrada: cfgMapa.CARGA_SABADO_ENTRADA ?? 1230,
            sabadoSaida: cfgMapa.CARGA_SABADO_SAIDA ?? 120,
          },
        }
        const espelho = espelhoControlePonto({
          inicio: periodo.inicio,
          fim: periodo.fim,
          hojeISO,
          excecoes: excRes.data ?? [],
          feriados: ferRes.data ?? [],
          ferias: fasRes.data ?? [],
          config: pontoConfigFmt,
          todasExcecoes: todasRes.data ?? [],
        })

        // Fluxo de caixa
        const fluxo = calcularEntradasDespesas({ movimentacoes: movsPeriodo, periodo })

        // Recebimentos (datas/valores reais)
        const dataRealPorLancamento = {}
        const valorRealPorLancamento = {}
        for (const m of movsWide) {
          dataRealPorLancamento[m.id] = m.data
          valorRealPorLancamento[m.id] = Number(m.valor)
        }
        const receb = calcularRecebidoHoras({
          planejamentosRealizados: planejamentos,
          fixoSemana: pontoConfigFmt.fixoSemana,
          periodo,
          dataRealPorLancamento,
          valorRealPorLancamento,
        })

        // Gasto por categoria + detalhe
        const gastoCategoria = calcularGastoPorCategoria({ movimentacoes: movsPeriodo, compras, periodo })
        const detalheCategoria = {}
        for (const l of gastoCategoria.linhas ?? []) {
          const info = analisarCategoria({
            categoria: l.categoria,
            movimentacoes: movsPeriodo,
            compras,
            periodo,
            limite: 1000,
            incluirEntradas: false,
          })
          detalheCategoria[l.categoria] = info.lancamentos
        }

        // Faturas reais (v_faturas) com vencimento em dia útil
        const cartaoPorId = new Map(cartoes.map((c) => [c.id, c]))
        const faturas = (faturasReais ?? [])
          .map((f) => {
            const cartao = cartaoPorId.get(f.cartao_id)
            const vencimento = vencimentoRealISO(f.mes_fatura, cartao?.dia_vencimento ?? 1, ferRes.data ?? [])
            return {
              cartao: cartao?.nome ?? 'Cartão',
              vencimento,
              valor: Number(f.valor_total) || 0,
              pago: Number(f.valor_pago) || 0,
              restante: Number(f.valor_restante) || 0,
              status: f.status ?? 'aberta',
            }
          })
          .sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1))

        // Saldos finais (contas reconstruídas)
        const saldos = calcularSaldosFinais({
          contas,
          movimentacoes: movsWide,
          fimISO: periodo.fim,
          coberturaMinima,
        })

        // Caixinhas reconstruídas em periodo.fim
        const saldoCaixinhaEm = new Map()
        for (const m of caixinhaMovs) {
          if (String(m.data) > periodo.fim) continue
          saldoCaixinhaEm.set(
            m.caixinha_id,
            (saldoCaixinhaEm.get(m.caixinha_id) ?? 0) + sinalCaixinha(m.tipo) * (Number(m.valor) || 0),
          )
        }
        const caixinhasReconstruidas = caixinhas
          .map((c) => ({
            nome: c.nome,
            saldo: Math.round((saldoCaixinhaEm.has(c.id) ? saldoCaixinhaEm.get(c.id) : 0) * 100) / 100,
          }))
          .filter((c) => {
            const orig = caixinhas.find((x) => x.nome === c.nome)
            return c.saldo !== 0 || (orig && saldoCaixinhaEm.has(orig.id))
          })
        const totalCaixinhas = caixinhasReconstruidas.reduce((a, c) => a + c.saldo, 0)
        const patrimonioTotal = (saldos.total ?? 0) + totalCaixinhas

        if (!ativo) return
        setDados({
          fluxo,
          resumoPonto: espelho.resumo,
          receb,
          gastoCategoria,
          detalheCategoria,
          faturas,
          saldos,
          caixinhas: caixinhasReconstruidas,
          totalCaixinhas,
          patrimonioTotal,
        })
      })
      .catch((e) => {
        if (!ativo) return
        setErro(e?.message ?? String(e))
        setDados(null)
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })

    return () => {
      ativo = false
    }
  }, [periodo?.inicio, periodo?.fim])

  return { carregando, erro, dados }
}