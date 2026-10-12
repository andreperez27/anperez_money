// ============================================================================
// RELATÓRIO CONTROLE DE PONTO — hook (aba dos Relatórios + PDF)
// ============================================================================
// Um único motor de dados (espelhoControlePonto, lib pura) por trás da aba e
// do PDF. Busca: exceções da faixa estendida (espelho dia a dia), todas as
// exceções (bloco do banco, all-time), feriados + config + férias (globais).
// ============================================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { hoje } from '../lib/compartilhados'
import { espelhoControlePonto } from '../lib/controlePontoCalc'

export function useRelatorioControlePonto(periodo) {
  const [excecoes, setExcecoes] = useState([])
  const [todas, setTodas] = useState([])
  const [feriados, setFeriados] = useState([])
  const [ferias, setFerias] = useState([])
  const [config, setConfig] = useState({ fixoSemana: 1650 })
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    let ativo = true
    if (!periodo?.inicio || !periodo?.fim) {
      setExcecoes([])
      setCarregando(false)
      return undefined
    }
    setCarregando(true)
    setErro(null)
    Promise.all([
      supabase
        .from('ponto_excecoes')
        .select('*')
        .gte('data', periodo.inicio)
        .lte('data', periodo.fim)
        .order('data'),
      supabase.from('ponto_excecoes').select('*').order('data').limit(5000),
      supabase.from('ponto_feriados').select('data, nome').order('data'),
      supabase.from('ponto_config').select('chave, valor'),
      supabase.from('ponto_ferias').select('*').order('data_inicio'),
    ])
      .then(([excRes, todasRes, ferRes, cfgRes, fasRes]) => {
        if (!ativo) return
        for (const r of [excRes, todasRes, ferRes, cfgRes, fasRes]) {
          if (r.error) throw new Error(r.error.message)
        }
        setExcecoes(excRes.data ?? [])
        setTodas(todasRes.data ?? [])
        setFeriados(ferRes.data ?? [])
        const mapa = {}
        for (const l of cfgRes.data ?? []) mapa[l.chave] = Number(l.valor)
        setConfig({
          fixoSemana: mapa.VALOR_FIXO_SEMANA ?? 1650,
          temposCarga: {
            utilEntrada: mapa.CARGA_UTIL_ENTRADA ?? 1230,
            utilSaida: mapa.CARGA_UTIL_SAIDA ?? 180,
            sabadoEntrada: mapa.CARGA_SABADO_ENTRADA ?? 1230,
            sabadoSaida: mapa.CARGA_SABADO_SAIDA ?? 120,
          },
        })
        setFerias(fasRes.data ?? [])
      })
      .catch((e) => {
        if (!ativo) return
        setErro(e.message)
        setExcecoes([])
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })
    return () => {
      ativo = false
    }
  }, [periodo?.inicio, periodo?.fim])

  const hojeISO = hoje()

  const dados = useMemo(() => {
    if (!periodo?.inicio || !periodo?.fim) return null
    return espelhoControlePonto({
      inicio: periodo.inicio,
      fim: periodo.fim,
      hojeISO,
      excecoes,
      feriados,
      ferias,
      config,
      todasExcecoes: todas,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excecoes, todas, feriados, ferias, config, periodo?.inicio, periodo?.fim])

  return { carregando, erro, dados }
}
