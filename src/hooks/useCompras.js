import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'

// Itens da fatura de um cartão em um mês específico.
//
// - itens: parcelas daquele mês com a descrição/data da compra de origem
//   (ordem por data da compra desc, depois número da parcela).
// - pagamentos: registros de fatura_pagamentos do cartão naquele mês.
//
// Como parcelas não carregam cartao_id, a busca é em dois passos: primeiro
// pegamos os ids das compras ativas do cartão, depois filtramos as parcelas
// por esses ids + mes_fatura. Não fabrica dados que não existem no schema.
export function useCompras(cartaoId, mesFatura) {
  const [itens, setItens] = useState([])
  const [pagamentos, setPagamentos] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)

  const carregar = useCallback(async () => {
    if (!cartaoId || !mesFatura) {
      setItens([])
      setPagamentos([])
      setCarregando(false)
      return
    }

    const { data: compras, error: errCompras } = await supabase
      .from('compras')
      .select('id')
      .eq('cartao_id', cartaoId)
      .eq('ativa', true)

    if (errCompras) throw new Error(errCompras.message)

    const idsCompras = (compras || []).map((c) => c.id)

    // Sem compras no cartão não há parcelas nem o que filtrar — só
    // pagamentos (e mesmo assim apenas se o id do cartão for válido).
    if (idsCompras.length === 0) {
      const { data: pags, error: errPags } = await supabase
        .from('fatura_pagamentos')
        .select('*')
        .eq('cartao_id', cartaoId)
        .eq('mes_fatura', mesFatura)
        .order('data_pagamento', { ascending: false })
      if (errPags) throw new Error(errPags.message)
      return { itens: [], pagamentos: pags || [] }
    }

    const [{ data: parcelas, error: errParcelas }, { data: pags, error: errPags }] =
      await Promise.all([
        supabase
          .from('parcelas')
          .select('*, compras(id, descricao, data, valor_total, n_parcelas)')
          .eq('mes_fatura', mesFatura)
          .in('compra_id', idsCompras)
          .order('numero'),
        supabase
          .from('fatura_pagamentos')
          .select('*')
          .eq('cartao_id', cartaoId)
          .eq('mes_fatura', mesFatura)
          .order('data_pagamento', { ascending: false }),
      ])

    if (errParcelas) throw new Error(errParcelas.message)
    if (errPags) throw new Error(errPags.message)

    return { itens: parcelas || [], pagamentos: pags || [] }
  }, [cartaoId, mesFatura])

  useEffect(() => {
    let ativo = true
    carregar()
      .then((res) => {
        if (!ativo) return
        setItens(res.itens)
        setPagamentos(res.pagamentos)
      })
      .catch((e) => {
        if (!ativo) return
        setErro(e.message)
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })

    return () => {
      ativo = false
    }
  }, [carregar])

  // Recarrega os itens e pagamentos da fatura (após lançar compra etc.).
  async function atualizar() {
    const res = await carregar()
    setItens(res.itens)
    setPagamentos(res.pagamentos)
    setErro(null)
  }

  return { itens, pagamentos, carregando, erro, atualizar }
}

// Extrato do cartão: lista cronológica de TODAS as parcelas do cartão num
// intervalo de meses de fatura (inicio..fim em 'YYYY-MM'), independente de
// uma fatura específica. Cada linha: data+descricao (da compra), parcela
// n/N, valor e mês_fatura.
//
// Como parcelas não carregam cartao_id, a busca é em 2 passos (mesmo padrão
// de useCompras): ids das compras ATIVAS do cartão → parcelas dessas compras
// com mes_fatura entre inicio e fim. Ordena por data da compra desc e, em
// seguida, número da parcela (lançamentos mais recentes primeiro).
export function useExtratoCartao(cartaoId, { inicio, fim, incluirInativas = false, habilitado = true } = {}) {
  const [itens, setItens] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)

  const carregar = useCallback(async () => {
    // Sem cartão OU sem filtro habilitado (ex.: personalizado inválido):
    // não há o que buscar.
    if (!cartaoId || !habilitado) {
      setItens([])
      setCarregando(false)
      return
    }

    let queryCompras = supabase.from('compras').select('id').eq('cartao_id', cartaoId)
    if (!incluirInativas) queryCompras = queryCompras.eq('ativa', true)
    const { data: compras, error: errCompras } = await queryCompras
    if (errCompras) throw new Error(errCompras.message)

    const ids = (compras || []).map((c) => c.id)
    if (ids.length === 0) {
      return { itens: [] }
    }

    let queryParcelas = supabase
      .from('parcelas')
      .select('*, compras(id, descricao, data, valor_total, n_parcelas)')
      .in('compra_id', ids)
    if (inicio) queryParcelas = queryParcelas.gte('mes_fatura', inicio)
    if (fim) queryParcelas = queryParcelas.lte('mes_fatura', fim)

    const { data: parcelas, error: errParcelas } = await queryParcelas
    if (errParcelas) throw new Error(errParcelas.message)

    // Ordena por VENCIMENTO da parcela (mes_fatura), do mais próximo do
    // vencimento ao mais distante — comportamento de extrato de fatura de
    // cartão real, onde parcelas futuras da mesma compra aparecem nos meses
    // corretos (não agrupadas pelas mais recentes). Dentro do mesmo mês,
    // agrupa a mesma compra pela data de origem (mais antiga primeiro) e
    // pela ordem da parcela (1/3, 2/3, 3/3).
    const ordenadas = (parcelas || []).sort((a, b) => {
      if (a.mes_fatura !== b.mes_fatura) {
        return a.mes_fatura < b.mes_fatura ? -1 : 1
      }
      const da = a.compras?.data ?? ''
      const db = b.compras?.data ?? ''
      if (da !== db) return da < db ? -1 : 1
      return (a.numero ?? 0) - (b.numero ?? 0)
    })

    return { itens: ordenadas }
  }, [cartaoId, inicio, fim, incluirInativas, habilitado])

  useEffect(() => {
    let ativo = true
    carregar()
      .then((res) => {
        if (!ativo) return
        setItens(res.itens)
      })
      .catch((e) => {
        if (!ativo) return
        setErro(e.message)
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })

    return () => {
      ativo = false
    }
  }, [carregar])

  // Recarrega o extrato e atualiza o estado (após editar/excluir compra).
  async function atualizar() {
    const res = await carregar()
    setItens(res.itens)
    setErro(null)
  }

  return { itens, carregando, erro, atualizar }
}
