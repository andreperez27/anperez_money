// ============================================================================
// ANÁLISE / BUSCA POR CATEGORIA — hook (aba dos Relatórios)
// ============================================================================
// Busca os dados BRUTOS que a fonte única de categorização precisa:
//  1) movimentações das contas na faixa do período;
//  2) compras do cartão ATIVAS na mesma faixa.
// A categorização/filtragem/agregação fica na lib PURA src/lib/relatorioPdf.js
// (lancamentosCategorizados → calcularGastoPorCategoria e analisarCategoria) —
// o hook NÃO repete regra nenhuma, só entrega os arrays.
// ============================================================================

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useAnaliseCategoria(periodo) {
  const [movimentacoes, setMovimentacoes] = useState([])
  const [compras, setCompras] = useState([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    let ativo = true
    if (!periodo?.inicio || !periodo?.fim) {
      setMovimentacoes([])
      setCompras([])
      setCarregando(false)
      setErro(null)
      return
    }
    setCarregando(true)
    setErro(null)
    Promise.all([
      supabase
        .from('movimentacoes')
        .select('*')
        .gte('data', periodo.inicio)
        .lte('data', periodo.fim),
      supabase
        .from('compras')
        .select('*')
        .eq('ativa', true)
        .gte('data', periodo.inicio)
        .lte('data', periodo.fim),
    ])
      .then(([movs, comprasP]) => {
        if (!ativo) return
        if (movs.error) throw new Error(movs.error.message)
        if (comprasP.error) throw new Error(comprasP.error.message)
        setMovimentacoes(movs.data ?? [])
        setCompras(comprasP.data ?? [])
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

  return { movimentacoes, compras, carregando, erro }
}