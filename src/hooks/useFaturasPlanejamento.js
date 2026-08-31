import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useCartoes } from './useCartoes'

// ============================================================================
// FATURA AUTOMÁTICA NO PLANEJAMENTO — hook.
// ============================================================================
// Busca, para CADA cartão ativo do usuário, as faturas REAIS de todos os meses
// (linhas da view v_faturas). O Planejamento consome os dados para montar os
// itens sintéticos de fatura, combinando o dado real (compras já lançadas de
// fato) com os planejamentos previstos de destino cartão (projeção futura).
// Nada do módulo Cartões é recalculado (a view já calcula; aqui só lemos).
//
// A efetivação ("Pagar") chama a MESMA RPC pagar_fatura do módulo Cartões e
// opera SEMPRE sobre dado real (nunca sobre previstos); após o sucesso os
// dados são relidos.
// ============================================================================

export function useFaturasPlanejamento() {
  // Cartões do usuário: useCartoes() com incluirInativos devolve TODOS os
  // cartões (ativos e inativos). Um planejamento previsto com destino Cartão
  // pode apontar para um cartão que ficou inativo (ex.: o Seguro configurado
  // num cartão desativado); mesmo assim a PROJEÇÃO da fatura (e o "Lançar →
  // Cartão") deve funcionar usando esse cartão — não exigir que ele esteja
  // ativo, apenas que EXISTA.
  const { cartoes, carregando: carregandoCartoes, erro: erroCartoes } = useCartoes(null, {
    incluirInativos: true,
  })

  // faturasReais: [{ cartao, mes, valor_restante }] — todas as faturas (de
  // todos os meses) de todos os cartões ativos. O Planejamento decide quais
  // meses entram na projeção conforme o período visível.
  const [faturasReais, setFaturasReais] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)

  const carregar = useCallback(async () => {
    if (!cartoes || cartoes.length === 0) {
      setFaturasReais([])
      return []
    }
    const ids = cartoes.map((c) => c.id)
    const { data, error } = await supabase
      .from('v_faturas')
      .select('*')
      .in('cartao_id', ids)
      .order('mes_fatura', { ascending: false })
    if (error) throw new Error(error.message)

    const cartaoPorId = new Map(cartoes.map((c) => [c.id, c]))
    return (data || [])
      .filter((f) => f && f.cartao_id && cartaoPorId.has(f.cartao_id))
      .map((f) => ({
        cartao: cartaoPorId.get(f.cartao_id),
        mes: f.mes_fatura,
        valor_restante: f.valor_restante,
      }))
  }, [cartoes])

  useEffect(() => {
    let ativo = true
    setCarregando(true)
    setErro(null)
    carregar()
      .then((res) => {
        if (!ativo) return
        setFaturasReais(res)
      })
      .catch((e) => {
        if (!ativo) return
        setErro(e.message)
        setFaturasReais([])
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })
    return () => {
      ativo = false
    }
  }, [carregar])

  // Pagar a fatura em aberto de um cartão via RPC existente pagar_fatura.
  // Funciona SOMENTE sobre dado real (a RPC valida contra o Postgres); nunca
  // deve receber valores de previstos que ainda não são parcelas reais.
  async function pagarFatura({ cartao_id, valor, data, mes_fatura, descricao }) {
    if (!cartao_id) throw new Error('Selecione o cartão antes de pagar a fatura.')
    const { data: pagamentoId, error } = await supabase.rpc('pagar_fatura', {
      p_cartao_id: cartao_id,
      p_valor_pago: valor,
      p_data_pagamento: data || undefined,
      p_mes_fatura: mes_fatura || undefined,
      p_descricao: descricao || null,
    })
    if (error) throw new Error(error.message)

    const res = await carregar()
    setFaturasReais(res)
    setErro(null)
    return pagamentoId
  }

  // Recarrega as faturas (após mutações externas, ex.: lançar compra).
  async function recarregar() {
    const res = await carregar()
    setFaturasReais(res)
    setErro(null)
  }

  return {
    faturasReais,
    cartoes,
    carregando: carregando || carregandoCartoes,
    erro: erro || erroCartoes,
    pagarFatura,
    recarregar,
  }
}
