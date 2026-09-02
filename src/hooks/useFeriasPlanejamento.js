import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'

// ============================================================================
// FÉRIAS NO PLANEJAMENTO — hook leve.
// ============================================================================
// Lê as marcarções de FÉRIAS (tabela ponto_ferias) que serão injetadas no
// Planejamento como itens marcadores (R$ 0) na data_inicio de cada intervalo.
// A fonte da verdade é o Ponto Inteligente (`usePonto`); aqui apenas lemos o
// dado pronto (intervalos { data_inicio, data_fim }) para exibir como aviso de
// data futura — nada é gravado nem editado por este hook.
// ============================================================================

export function useFeriasPlanejamento() {
  const [ferias, setFerias] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from('ponto_ferias')
      .select('*')
      .order('data_inicio', { ascending: true })
    if (error) throw new Error(error.message)
    return data ?? []
  }, [])

  useEffect(() => {
    let ativo = true
    setCarregando(true)
    setErro(null)
    carregar()
      .then((res) => {
        if (!ativo) return
        setFerias(res)
      })
      .catch((e) => {
        if (!ativo) return
        setErro(e.message)
        setFerias([])
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })
    return () => {
      ativo = false
    }
  }, [carregar])

  async function recarregar() {
    const res = await carregar()
    setFerias(res)
    setErro(null)
  }

  return { ferias, carregando, erro, recarregar }
}