import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Esse hook centraliza uma pergunta que várias telas vão fazer: "tem
// alguém logado agora, e quem é?". Em vez de cada página checar isso do
// zero, elas importam useAuth() e recebem a resposta pronta, sempre
// atualizada.
export function useAuth() {
  const [session, setSession] = useState(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    // Ao montar, pergunta pro Supabase se já existe uma sessão salva
    // (por exemplo, você fechou o navegador ontem logado e abriu hoje).
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setCarregando(false)
    })

    // onAuthStateChange fica "escutando" em segundo plano. Toda vez que
    // alguém faz login, logout, ou o token expira, essa função dispara
    // sozinha e atualiza o estado, sem você precisar checar manualmente
    // em cada tela.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_evento, session) => {
        setSession(session)
      }
    )

    // Cleanup: quando o componente que usa esse hook for desmontado,
    // paramos de escutar, pra não acumular listeners esquecidos.
    return () => subscription.unsubscribe()
  }, [])

  return {
    session,
    usuario: session?.user ?? null,
    logado: !!session,
    carregando,
  }
}
