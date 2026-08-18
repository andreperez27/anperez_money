import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Busca centralizada das contas do usuário logado.
//
// POR QUE EXISTE: Dashboard (agora) e Contas/Movimentações (futuro) precisam
// da mesma lista de contas. Com a busca num hook só, nenhuma tela repete o
// useEffect — e se um dia a consulta mudar, muda num lugar único.
//
// Como funciona: o supabase-js devolve uma promessa com { data, error }.
// Repare que NÃO existe filtro .eq('user_id', ...) aqui: quem garante que
// só voltam as suas contas é o RLS no banco (política com auth.uid()),
// aplicado automaticamente em toda consulta. Escrever o filtro no código
// seria redundante e esconderia uma falha de RLS.
export function useContas() {
  const [contas, setContas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    // "ativo" protege contra setState depois do desmonte: se o Dashboard
    // for desmontado no meio da busca (ex.: logout), a resposta que
    // eventualmente chegar é simplesmente ignorada.
    let ativo = true

    supabase
      .from('contas')
      .select('*')
      .order('nome')
      .then(({ data, error }) => {
        if (!ativo) return
        if (error) {
          setErro(error.message)
        } else {
          setContas(data)
        }
        setCarregando(false)
      })

    return () => {
      ativo = false
    }
  }, [])

  return { contas, carregando, erro }
}