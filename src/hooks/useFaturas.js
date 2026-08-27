import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'

// Helper local para o mês corrente no formato 'YYYY-MM' (fatura do mês).
export function mesAtual(data = new Date()) {
  const ano = data.getFullYear()
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  return `${ano}-${mes}`
}

// Dados de fatura de UM cartão + limite disponível calculado no banco.
//
// - faturas: linhas de v_faturas do cartão ordenadas da mais recente para a
//   mais antiga (status derivado: 'aberta' | 'parcialmente_paga' | 'paga').
// - limiteDisponivel: resultado da RPC calcular_limite_disponivel(p_cartao_id).
// - pagarFatura: chama a RPC atômica pagar_fatura(cartao_id, valor, data,
//   mes_fatura) e relê os dados. Lança a mensagem da exceção do banco verbatim
//   (ex.: "A fatura 2026-03 já está paga.") para a tela exibir.
export function useFaturas(cartaoId) {
  const [faturas, setFaturas] = useState([])
  const [limiteDisponivel, setLimiteDisponivel] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)

  const carregar = useCallback(async () => {
    if (!cartaoId) {
      setFaturas([])
      setLimiteDisponivel(null)
      setCarregando(false)
      return
    }

    const [{ data: faturasData, error: errFaturas }, { data: limite, error: errLimite }] =
      await Promise.all([
        supabase
          .from('v_faturas')
          .select('*')
          .eq('cartao_id', cartaoId)
          .order('mes_fatura', { ascending: false }),
        supabase.rpc('calcular_limite_disponivel', { p_cartao_id: cartaoId }),
      ])

    if (errFaturas) throw new Error(errFaturas.message)
    if (errLimite) throw new Error(errLimite.message)

    return { faturas: faturasData || [], limiteDisponivel: limite }
  }, [cartaoId])

  useEffect(() => {
    let ativo = true
    carregar()
      .then((res) => {
        if (!ativo) return
        setFaturas(res.faturas)
        setLimiteDisponivel(res.limiteDisponivel)
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

  // Pagar fatura (total ou parcial). Retorna o id do pagamento.
  async function pagarFatura({ valor, data, mes_fatura, descricao }) {
    if (!cartaoId) throw new Error('Selecione um cartão antes de pagar a fatura.')

    const { data: pagamentoId, error } = await supabase.rpc('pagar_fatura', {
      p_cartao_id: cartaoId,
      p_valor_pago: valor,
      p_data_pagamento: data,
      p_mes_fatura: mes_fatura,
      p_descricao: descricao || null,
    })
    if (error) throw new Error(error.message)

    const res = await carregar()
    setFaturas(res.faturas)
    setLimiteDisponivel(res.limiteDisponivel)
    setErro(null)
    return pagamentoId
  }

  // Recarrega faturas e limite disponível do cartão (após lançar compra, etc.).
  async function atualizar() {
    const res = await carregar()
    setFaturas(res.faturas)
    setLimiteDisponivel(res.limiteDisponivel)
    setErro(null)
  }

  // Desfaz o pagamento de uma fatura via RPC atômica desfazer_pagamento:
  // remove os fatura_pagamentos e as movimentações de SAÍDA vinculadas
  // (a trigger trg_atualizar_saldo reverte o saldo da conta). Relê os dados.
  async function desfazerPagamento({ mes_fatura }) {
    if (!cartaoId) throw new Error('Selecione um cartão antes de desfazer o pagamento.')

    const { error } = await supabase.rpc('desfazer_pagamento', {
      p_cartao_id: cartaoId,
      p_mes_fatura: mes_fatura,
    })
    if (error) throw new Error(error.message)

    const res = await carregar()
    setFaturas(res.faturas)
    setLimiteDisponivel(res.limiteDisponivel)
    setErro(null)
  }

  return { faturas, limiteDisponivel, carregando, erro, pagarFatura, desfazerPagamento, atualizar }
}
