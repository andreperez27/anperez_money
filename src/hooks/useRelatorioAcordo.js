// ============================================================================
// RELATÓRIO "ACORDO TRABALHISTA" — hook (aba dos Relatórios)
// ============================================================================
// O acordo trabalhista é um FATO FECHADO e finalizado (histórico migrado de
// 2021 a 2025, origem 'historico_acordo'), não um fluxo contínuo que se
// acumula mês a mês. Por isso a aba NÃO consome o período do
// SeletorPeriodoRelatorio da página (que, inclusive, some nesta aba): este
// hook busca TODOS os registros de origem 'historico_acordo' e delega a
// agregação à lib PURA calcularRecebidoAcordo (src/lib/relatorioAcordo.js),
// que filtra origem='historico_acordo' e entrega os números.
//
// O período efetivo é DERIVADO do próprio dado (menor → maior data_prevista),
// cobrindo o acordo do início ao fim, sem exigir escolha de período. A
// organização interna é navegação própria da aba:
//   • gráfico por ANO (porAno — UMA barra por ano);
//   • cards: total recebido no acordo + nº de depósitos (sempre o TOTAL do
//     acordo inteiro, sem filtro de ano);
//   • `anos`: resumo por ano (ano + total do ano + nº depósitos) para a lista
//     colapsável da aba (acordeão, um ano por vez); cada ano carrega a lista
//     cronológica dos próprios depósitos.
//
// O export PDF usa os dados crus expostos (dados: totalRecebido + depositos +
// inicio/fim) — o Acordo fica FORA da lógica "aba ativa + período + categoria"
// do export das demais abas, e o PDF mantém a tabela completa de depósitos.
// ============================================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { calcularRecebidoAcordo } from '../lib/relatorioAcordo'
import { formatoReal } from '../lib/compartilhados'

export function useRelatorioAcordo() {
  const [itens, setItens] = useState([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    let ativo = true
    setCarregando(true)
    setErro(null)
    // Só os recebimentos do ACORDO (origem exclusiva 'historico_acordo'). A
    // RLS isola o user_id no banco (padrão do projeto). Sem faixa de período:
    // o acordo vai do primeiro ao último depósito.
    supabase
      .from('planejamentos')
      .select('*')
      .eq('origem', 'historico_acordo')
      .order('data_prevista')
      .then(({ data, error }) => {
        if (error) throw new Error(error.message)
        if (ativo) setItens(data ?? [])
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
  }, [])

  // Período efetivo DERIVADO do dado: primeiro ao último depósito realizado.
  const periodo = useMemo(() => {
    const datas = (Array.isArray(itens) ? itens : [])
      .filter(
        (p) =>
          p &&
          p.origem === 'historico_acordo' &&
          p.tipo_op === 'Entrada' &&
          p.estado === 'realizado' &&
          Number(p.valor) > 0,
      )
      .map((p) => String(p.data_prevista))
      .sort()
    if (datas.length === 0) return null
    return { tipo: 'acordo', inicio: datas[0], fim: datas[datas.length - 1] }
  }, [itens])

  const dados = useMemo(() => {
    if (!periodo) {
      return { totalRecebido: 0, depositos: [], porMes: [], porData: [], porAno: [] }
    }
    return calcularRecebidoAcordo({ planejamentos: itens, periodo })
  }, [periodo, itens])

  const apresentacao = useMemo(() => {
    const temData = dados.depositos.length > 0
    const seriesAno = dados.porAno

    const cards = temData
      ? [
          { label: 'Total recebido no acordo', valor: formatoReal.format(dados.totalRecebido) },
          { label: 'Depósitos no acordo', valor: String(dados.depositos.length) },
        ]
      : []

    // Gráfico: UMA barra por ANO (o acordo inteiro, 2021–2025).
    const grafico = temData
      ? {
          rotulos: seriesAno.map((s) => s.ano),
          valores: seriesAno.map((s) => s.recebido),
        }
      : { rotulos: [], valores: [] }

    // Resumo por ano (ano, total do ano, nº de depósitos) para a lista
    // colapsável da aba — cada ano já carrega os depósitos pra expansão.
    const anos = temData
      ? seriesAno.map((s) => ({
          ano: s.ano,
          recebido: s.recebido,
          quantidade: s.depositos.length,
          depositos: s.depositos.map((d) => ({
            data: d.data,
            descricao: d.descricao || '',
            valor: d.valor,
          })),
        }))
      : []

    return { cards, grafico, anos }
  }, [dados])

  return {
    carregando,
    erro,
    temData: dados.depositos.length > 0,
    // Dados crus para o export PDF do acordo (total + depósitos + faixa real).
    dados: { ...dados, inicio: periodo?.inicio ?? null, fim: periodo?.fim ?? null },
    ...apresentacao,
  }
}