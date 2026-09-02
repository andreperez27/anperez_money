import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { estilosComuns } from '../lib/compartilhados'

// Troca de senha: usa a SESSÃO atual (não pede a senha antiga — quem
// está logado é o dono). updateUser está disponível para o usuário
// autenticado; é a mesma API que o dashboard do Supabase usa.
export default function TrocarSenha() {
  const navigate = useNavigate()
  const [novaSenha, setNovaSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [mensagem, setMensagem] = useState(null)
  const [enviando, setEnviando] = useState(false)

  async function handleTrocarSenha(e) {
    e.preventDefault()
    setMensagem(null)

    if (novaSenha.length < 6) {
      setMensagem({ tipo: 'erro', texto: 'A nova senha precisa de pelo menos 6 caracteres.' })
      return
    }
    if (novaSenha !== confirmacao) {
      setMensagem({ tipo: 'erro', texto: 'A confirmação não confere com a nova senha.' })
      return
    }

    setEnviando(true)
    const { error } = await supabase.auth.updateUser({ password: novaSenha })
    setEnviando(false)

    if (error) {
      setMensagem({ tipo: 'erro', texto: `Não foi possível trocar a senha: ${error.message}` })
      return
    }
    setNovaSenha('')
    setConfirmacao('')
    setMensagem({ tipo: 'ok', texto: 'Senha alterada com sucesso.' })
  }

  return (
    <div style={estilosComuns.conteudo}>
      <section style={estilosComuns.secao}>
        <h2>Trocar senha</h2>
        <form onSubmit={handleTrocarSenha} style={estilosComuns.form}>
          <input
            type="password"
            placeholder="Nova senha (mín. 6 caracteres)"
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
            required
            minLength={6}
            style={estilosComuns.input}
          />
          <input
            type="password"
            placeholder="Confirmar nova senha"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            required
            minLength={6}
            style={estilosComuns.input}
          />
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="submit" disabled={enviando} style={estilosComuns.botaoCriar}>
              {enviando ? 'Salvando...' : 'Trocar senha'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/configuracoes')}
              style={{
                padding: '0.6rem',
                borderRadius: '8px',
                border: '1px solid #374151',
                background: 'none',
                color: '#e5e7eb',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Voltar
            </button>
          </div>
        </form>
        {mensagem && (
          <p style={mensagem.tipo === 'ok' ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>
            {mensagem.texto}
          </p>
        )}
      </section>
    </div>
  )
}
