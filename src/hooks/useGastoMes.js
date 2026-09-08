import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { somarGastoDoMes, ultimoDiaDoMes } from '../lib/gastoCartao'
import { mesAtual } from './useFaturas'

// Gasto do mês em cartão de crédito = soma do VALOR TOTAL das compras (não
// das parcelas/faturas) com compras.data dentro do mês-alvo. Uma compra de
// R$ 300 em 3x feita em setembro conta R$ 300 em setembro e R$ 0 depois.
//
// Soma TODAS as compras ATIVAS do usuário (RLS) por padrão (card agregado da
// tela Cartões); passe `cartaoId` para o gasto de UM cartão (breakdown por
// cartão, como no app antigo).
//
// Busca única: compras ativas com data no intervalo do mês-alvo — sem
// passagem por parcelas nem mes_fatura (o critério é só a data da compra).
export function useGastoMes({ cartaoId = null, mes = null } = {}) {
  const [gasto, setGasto] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)
  const mesAlvo = mes || mesAtual()

  const carregar = useCallback(async () => {
    const inicio = `${mesAlvo}-01`
    const fim = ultimoDiaDoMes(mesAlvo)
    if (!fim) return 0

    let query = supabase
      .from('compras')
      .select('data, valor_total')
      .eq('ativa', true)
      .gte('data', inicio)
      .lte('data', fim)
    if (cartaoId) query = query.eq('cartao_id', cartaoId)

    const { data: compras, error } = await query
    if (error) throw new Error(error.message)

    return somarGastoDoMes(compras || [], mesAlvo)
  }, [cartaoId, mesAlvo])

  useEffect(() => {
    let ativo = true
    carregar()
      .then((total) => {
        if (!ativo) return
        setGasto(total)
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

  // Recarrega o gasto após lançar/editar/excluir compra.
  async function atualizar() {
    const total = await carregar()
    setGasto(total)
    setErro(null)
  }

  return { gasto, mes: mesAlvo, carregando, erro, atualizar }
}