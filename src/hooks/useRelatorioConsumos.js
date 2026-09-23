// ============================================================================
// RELATÓRIO CONSUMOS — hook (aba dos Relatórios)
// ============================================================================
// Lê condominio_consumo_mensal (leitura_anterior, leitura_atual, valor, tipo,
// mes = dia 1º do mês de REFERÊNCIA do consumo) e delega o cálculo à lib pura
// consumoMensalCalc (agruparConsumoPorTipo). A tabela é minúscula (2 linhas
// por mês), então busca tudo e filtra por período no memo — sem query nova
// por navegação. RLS isola o usuário no banco, como nos demais hooks.
// ============================================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { agruparConsumoPorTipo } from '../lib/consumoMensalCalc'

export function useRelatorioConsumos(periodo) {
  const [linhas, setLinhas] = useState([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    let ativo = true
    setCarregando(true)
    setErro(null)
    supabase
      .from('condominio_consumo_mensal')
      .select('mes,mes_consumo,tipo,valor,leitura_atual,leitura_anterior')
      .order('mes', { ascending: true })
      .limit(2000)
      .then(({ data, error }) => {
        if (!ativo) return
        if (error) throw new Error(error.message)
        setLinhas(data ?? [])
      })
      .catch((e) => {
        if (!ativo) return
        setErro(e.message)
        setLinhas([])
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })
    return () => {
      ativo = false
    }
  }, [])

  const dados = useMemo(() => {
    if (!periodo?.inicio || !periodo?.fim) return { porTipo: {}, meses: [] }
    return agruparConsumoPorTipo(linhas, { inicio: periodo.inicio, fim: periodo.fim })
  }, [linhas, periodo?.inicio, periodo?.fim])

  return { carregando, erro, porTipo: dados.porTipo, meses: dados.meses }
}
