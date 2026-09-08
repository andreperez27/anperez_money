import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Feriados globais do Ponto (tabela ponto_feriados) — a MESMA fonte usada no
// módulo Ponto Inteligente. O vencimento real da fatura pula fim de semana E
// feriado; aqui reaproveitamos essa lista em vez de duplicar.
//
// Cache no módulo: a lista só é carregada uma vez por sessão (são poucos
// registros); todas as telas que precisam (Cartões, FaturaDetalhe, Planejamento)
// chamam este hook sem custo de query extra. Devolve array de 'YYYY-MM-DD' —
// a mesma convenção aceita por ehFeriado/ajustarParaDiaUtil.
let cacheFeriados = null

export function useFeriados() {
  const [feriados, setFeriados] = useState(cacheFeriados ?? [])
  const [carregado, setCarregado] = useState(cacheFeriados !== null)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    if (cacheFeriados) return
    let ativo = true
    supabase
      .from('ponto_feriados')
      .select('data')
      .then(({ data, error }) => {
        if (!ativo) return
        if (error) {
          setErro(error.message)
          setCarregado(true)
          return
        }
        cacheFeriados = (data ?? []).map((f) => f.data)
        setFeriados(cacheFeriados)
        setCarregado(true)
      })
    return () => {
      ativo = false
    }
  }, [])

  return { feriados, carregado, erro }
}