// ============================================================================
// RELATÓRIO "ENTRADAS X DESPESAS" — hook (aba dos Relatórios)
// ============================================================================
// Visão geral do fluxo de caixa do período: a fonte da verdade são as
// MOVIMENTAÇÕES das contas (decisão 07/09/2026) — fluxo real, que evita a
// duplicidade entre compra no cartão/pagamento da fatura (o pagamento JÁ é a
// Saída real na conta; não somamos fatura_pagamentos nem parcelas separadas).
// O hook busca:
//   1) TODAS as movimentações das contas do usuário na faixa do período;
//   2) as ORIGENS dos planejamentos que geraram movimentações (o id da
//      movimentação == lancamento_id do planejamento) — só para a lib derivar
//      'acordo'/'outros' quando conhecida; o resto vira 'salario' (decisão do
//      André: categorização fina virá depois, via planilha de pré-filtragem).
// A lib PURA calcularEntradasDespesas (src/lib/relatorioEntradasDespesas.js)
// filtra transferências internas e monta cards, gráfico e lista.
//
// Cards: total de entradas · total de despesas · saldo líquido (entradas −
// despesas, verde quando >= 0, vermelho quando negativo).
// Gráfico: BARRAS POR BUCKET em que cada bucket tem DUAS colunas lado a lado —
//   1) ENTRAADAS empilhadas por categoria (salário verde, acordo azul, outros
//      âmbar — as 3 barras empilhadas somam o total de entradas do bucket);
//   2) DESPESAS em cor única vermelha ao lado.
//   Granularidade (decisão 06/09/2026, diferente do "Recebido & horas"):
//      Mês → por SEMANA — há MUITO mais lançamentos aqui (despesas soltas o
//      mês inteiro), e porData deixaria o gráfico ilegível; agregar por semana
//      mantém as barras legíveis. Trimestre/Semestre/Ano/Personalizado → porMes.
//   A escolha vive em granularidadeDoFluxoDeCaixa (lib, testável).
// Lista: UMA LINHA POR LANÇAMENTO (entrada OU despesa): data · descrição ·
//   categoria da entrada (salário/acordo/outros) · valor; entrada pintada de
//   VERDE (#22C55E), despesa de VERMELHO (#EF4444).
// ============================================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { calcularEntradasDespesas, granularidadeDoFluxoDeCaixa } from '../lib/relatorioEntradasDespesas'
import { formatoReal } from '../lib/compartilhados'
import { MES_ABREV } from '../components/planejamento/comum'

const COR_SALARIO = '#22C55E'
const COR_ACORDO = '#3B82F6'
const COR_OUTROS = '#F59E0B'
const COR_DESPESA = '#EF4444'

const ROTULO_CATEGORIA = {
  salario: 'Salário',
  acordo: 'Acordo',
  outros: 'Outros',
}

function rotuloCurto(dataISO) {
  const [ano, mes, dia] = String(dataISO).split('-')
  return `${dia}/${mes}`
}

function rotuloLongo(dataISO) {
  const [ano, mes, dia] = String(dataISO).split('-')
  return `${dia}/${mes}/${ano}`
}

export function useRelatorioEntradasDespesas(periodo) {
  const [itens, setItens] = useState([])
  const [origens, setOrigens] = useState({})
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    let ativo = true
    if (!periodo?.inicio || !periodo?.fim) {
      setItens([])
      setOrigens({})
      setCarregando(false)
      return
    }
    setCarregando(true)
    setErro(null)
    // 1) Movimentações de TODAS as contas na faixa (RLS filtra o usuário).
    // 2) Origens dos planejamentos realizados que geraram movimentações:
    //    planejamentos.lancamento_id == movimentacoes.id → mapa id → origem.
    Promise.all([
      supabase
        .from('movimentacoes')
        .select('*')
        .gte('data', periodo.inicio)
        .lte('data', periodo.fim),
      supabase
        .from('planejamentos')
        .select('lancamento_id, origem')
        .eq('estado', 'realizado')
        .not('lancamento_id', 'is', null),
    ])
      .then(([movs, plan]) => {
        if (!ativo) return
        if (movs.error) throw new Error(movs.error.message)
        if (plan.error) throw new Error(plan.error.message)
        setItens(movs.data ?? [])
        const mapa = {}
        for (const p of plan.data ?? []) {
          if (p.lancamento_id) mapa[p.lancamento_id] = p.origem
        }
        setOrigens(mapa)
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
      return { totalEntradas: 0, totalDespesas: 0, saldo: 0, porMes: [], porData: [], porSemana: [], lancamentos: [] }
    }
    return calcularEntradasDespesas({ movimentacoes: itens, origens, periodo })
  }, [periodo, itens, origens])

  const apresentacao = useMemo(() => {
    const porSemana = granularidadeDoFluxoDeCaixa(periodo?.tipo) === 'semana'
    const series = porSemana ? dados.porSemana : dados.porMes
    const temData = dados.lancamentos.length > 0

    const cards = temData
      ? [
          { label: 'Total de entradas', valor: formatoReal.format(dados.totalEntradas), cor: COR_SALARIO },
          { label: 'Total de despesas', valor: formatoReal.format(dados.totalDespesas), cor: COR_DESPESA },
          {
            label: 'Saldo líquido',
            valor: `${dados.saldo >= 0 ? '+' : '−'} ${formatoReal.format(Math.abs(dados.saldo))}`,
            cor: dados.saldo >= 0 ? COR_SALARIO : COR_DESPESA,
          },
        ]
      : []

    // Gráfico de buckets: cada bucket = duas colunas lado a lado — entradas
    // empilhadas por categoria (3 fatias) e despesas (coluna única vermelha).
    const buckets = temData
      ? series.map((s) => ({
          colunas: [
            {
              fatias: [
                { cor: COR_SALARIO, valor: s.categorias.salario },
                { cor: COR_ACORDO, valor: s.categorias.acordo },
                { cor: COR_OUTROS, valor: s.categorias.outros },
              ],
            },
            { cor: COR_DESPESA, valor: s.despesas },
          ],
        }))
      : []

    const grafico = {
      rotulos: series.map((s) =>
        porSemana ? rotuloCurto(s.semana) : MES_ABREV[Number(s.mes.slice(5, 7)) - 1],
      ),
      buckets,
    }

    const linhas = temData
      ? dados.lancamentos.map((l) => {
          const entrada = l.tipo === 'entrada'
          return {
            celulas: [
              { texto: rotuloLongo(l.data) },
              { texto: l.descricao || '' },
              {
                texto: entrada ? ROTULO_CATEGORIA[l.categoria] ?? '' : 'Despesa',
                cor: entrada ? COR_SALARIO : COR_DESPESA,
              },
              { texto: formatoReal.format(l.valor), cor: entrada ? COR_SALARIO : COR_DESPESA, forte: true },
            ],
          }
        })
      : []

    return { cards, grafico, linhas }
  }, [dados, periodo])

  return {
    carregando,
    erro,
    temData: dados.lancamentos.length > 0,
    ...apresentacao,
  }
}