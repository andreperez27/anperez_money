import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Busca centralizada das contas do usuário logado.
//
// O RLS (política com auth.uid()) filtra no banco; aqui não existe
// filtro de user_id no código — quem garante o isolamento é o Postgres.
export function useContas() {
  const [contas, setContas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)

  // A consulta mora numa função própria para ser usada em dois momentos:
  // na montagem (useEffect) e após criar uma conta (criarConta), quando a
  // lista precisa ser recarregada sem que a página inteira recarregue.
  async function carregar() {
    const { data, error } = await supabase
      .from('contas')
      .select('*')
      .order('nome')
    if (error) throw new Error(error.message)
    return data
  }

  useEffect(() => {
    // "ativo" protege contra setState depois do desmonte do componente.
    let ativo = true

    carregar()
      .then((data) => {
        if (!ativo) return
        setContas(data)
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

  // Criar conta. O insert NÃO envia user_id: o DEFAULT auth.uid() que
  // foi criado no banco preenche com o dono da sessão no momento do
  // insert (quem insere é o Postgres, lendo o JWT da conexão). Se alguém
  // tentasse adulterar o payload com um user_id de outra pessoa, a
  // política RLS with check recusaria a operação com erro — o banco
  // decide, não o cliente.
  async function criarConta({ nome, tipo, saldo_atual }) {
    const { error } = await supabase
      .from('contas')
      .insert({ nome, tipo, saldo_atual })
    if (error) throw new Error(error.message)

    const data = await carregar()
    setContas(data)
    setErro(null)
  }

  return { contas, carregando, erro, criarConta }
}