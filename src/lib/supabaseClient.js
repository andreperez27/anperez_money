import { createClient } from '@supabase/supabase-js'

// import.meta.env é como o Vite expõe as variáveis do .env.local pro
// código. Repare: aqui a gente só LÊ a anon key, nunca a service_role.
// Se essas variáveis não existirem (por exemplo, você esqueceu de criar
// o .env.local), o app vai quebrar já na inicialização com um erro claro,
// em vez de falhar silenciosamente mais tarde numa tela qualquer.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Faltam as variáveis VITE_SUPABASE_URL e/ou VITE_SUPABASE_ANON_KEY. ' +
    'Copie o .env.example para .env.local e preencha com os valores do ' +
    'seu projeto Supabase (Project Settings → API).'
  )
}

// Essa é a ÚNICA vez que criamos uma conexão com o Supabase no projeto
// inteiro. Toda página vai importar este "supabase" já pronto, em vez de
// criar sua própria conexão. Isso mantém a sessão de login consistente
// entre todas as telas.
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
