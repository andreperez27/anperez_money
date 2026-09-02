import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Limite disponível de TODOS os cartões ativos (padrão de cartões
// para o card da Home ciclar entre o total e cada cartão).
//
// Reutiliza o cálculo no BANCO (RPC calcular_limite_disponivel) em vez de
// duplicar "limite − fatura em aberto" no front — mesma fonte da tela de
// Cartões (useFaturas). Devolve:
//   cartoesAtivos: lista de cartões ativos (com .limite e .nome);
//   limites: { [cartaoId]: limiteDisponivel } calculado no banco;
//   total: soma do limite disponível de todos os cartões ativos.
export function useLimitesCartoes() {
  const [cartoesAtivos, setCartoesAtivos] = useState([])
  const [limites, setLimites] = useState({})
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    let ativo = true

    async function carregar() {
      const { data: cartoes, error: errCartoes } = await supabase
        .from('cartoes')
        .select('id, nome, limite')
        .eq('ativo', true)
        .order('nome')
      if (errCartoes) throw new Error(errCartoes.message)

      const ativos = cartoes ?? []
      // Limite disponível de cada cartão calculado no banco (mesma RPC de
      // useFaturas) — preenchido em paralelo.
      const pares = await Promise.all(
        ativos.map(async (c) => {
          try {
            const { data, error } = await supabase.rpc('calcular_limite_disponivel', {
              p_cartao_id: c.id,
            })
            if (error) throw error
            return [c.id, Number(data ?? c.limite) || 0]
          } catch {
            // Se a RPC falhar (ex.: migration não aplicada), cai no limite
            // nominal — nunca quebra o card.
            return [c.id, Number(c.limite) || 0]
          }
        }),
      )

      return {
        ativos,
        limites: Object.fromEntries(pares),
      }
    }

    setCarregando(true)
    setErro(null)
    carregar()
      .then(({ ativos, limites: l }) => {
        if (!ativo) return
        setCartoesAtivos(ativos)
        setLimites(l)
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
  }, [])

  const total = cartoesAtivos.reduce(
    (soma, c) => soma + (limites[c.id] ?? (Number(c.limite) || 0)),
    0,
  )

  return { cartoesAtivos, limites, total, carregando, erro }
}
