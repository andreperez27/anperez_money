// ============================================================================
// RELATÓRIO CONSOLIDADO EM PDF — hook (10/09/2026)
// ============================================================================
// Reúne os dados que o template único precisa e delega a montagem dos QUATRO
// blocos para a lib pura src/lib/relatorioPdf.js (montarBlocosRelatorio).
// A geração do arquivo em si fica na página (src/lib/gerarPdfRelatorio.js).
//
// Buscas em paralelo:
//   1. movimentações na faixa do período          → Resumo + Gasto por categoria;
//   2. planejamentos na faixa (sem histórico)     → compromissos (listarPorPeriodo);
//   3. previstos de destino Cartão (todos)        → projeção das faturas
//                                                   (listarPrevistosCartao);
//   4. compras ATIVAS na faixa                    → Gasto por categoria;
//   5. movimentações com cobertura de 400 dias    → Saldos finais (mesma janela
//                                                   do card "Saldo projetado").
// Feriados (vencimento real das faturas), cartões + faturas reais (v_faturas)
// e contas vêm dos hooks existentes (useFeriados, useFaturasPlanejamento,
// useContaAtiva) — sem query duplicada.
// ============================================================================

import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { hoje } from '../lib/compartilhados'
import { adicionarDiasISO } from '../lib/saldoProjetado'
import { montarBlocosRelatorio } from '../lib/relatorioPdf'
import { useContaAtiva } from '../context/ContaAtivaContext'
import { useFaturasPlanejamento } from './useFaturasPlanejamento'
import { useFeriados } from './useFeriados'
import { usePlanejamentos } from './usePlanejamentos'

// Mesma janela de cobertura do card "Saldo projetado" (useSaldoProjetado):
// só reconstruímos saldo de períodos com movimentações cobertas por 400 dias.
const COBERTURA_PASSADO_DIAS = 400

export function useRelatorioPdf() {
  const { contas } = useContaAtiva()
  const { faturasReais, cartoes } = useFaturasPlanejamento()
  const { feriados } = useFeriados()
  const { listarPorPeriodo, listarPrevistosCartao } = usePlanejamentos()

  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(null)

  // Monta os blocos do período informado e os devolve (a página gera o PDF).
  async function gerar(periodo) {
    if (!periodo?.inicio || !periodo?.fim) {
      throw new Error('Defina um período válido antes de exportar o PDF.')
    }

    setCarregando(true)
    setErro(null)

    const hojeISO = hoje()
    const coberturaMinima = adicionarDiasISO(hojeISO, -COBERTURA_PASSADO_DIAS)

    try {
      const [movsRes, planejamentos, previstos, comprasRes, movsSaldoRes] = await Promise.all([
        supabase
          .from('movimentacoes')
          .select('*')
          .gte('data', periodo.inicio)
          .lte('data', periodo.fim),
        listarPorPeriodo(periodo.inicio, periodo.fim),
        listarPrevistosCartao(),
        supabase
          .from('compras')
          .select('*')
          .eq('ativa', true)
          .gte('data', periodo.inicio)
          .lte('data', periodo.fim),
        supabase
          .from('movimentacoes')
          .select('*')
          .gte('data', coberturaMinima)
          .lte('data', hojeISO),
      ])
      if (movsRes.error) throw new Error(movsRes.error.message)
      if (comprasRes.error) throw new Error(comprasRes.error.message)
      if (movsSaldoRes.error) throw new Error(movsSaldoRes.error.message)

      return montarBlocosRelatorio({
        periodo,
        movimentacoes: movsRes.data ?? [],
        itens: planejamentos,
        compras: comprasRes.data ?? [],
        faturasReais,
        previstosCartao: previstos,
        cartoes,
        contas,
        movimentacoesSaldo: movsSaldoRes.data ?? [],
        hojeISO,
        feriados,
        coberturaMinima,
      })
    } catch (e) {
      setErro(e.message)
      throw e
    } finally {
      setCarregando(false)
    }
  }

  return { gerar, carregando, erro }
}