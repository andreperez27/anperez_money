import { useState } from 'react'
import { Link } from 'react-router-dom'
import Contas from './Contas'
import CartoesConfig from '../components/CartoesConfig'
import { supabase } from '../lib/supabaseClient'
import { estilosComuns } from '../lib/compartilhados'

// Configurações: casa de tudo que é ação RARA — gerenciar contas
// (criar/editar/desativar) e acessar módulos consultados com menos
// frequência (Relatórios e Ponto Inteligente), que não merecem item no
// menu principal.
//
// A seção "Minhas Contas" reaproveita o componente Contas.jsx inteiro
// (formulário de nova conta + lista com destaque da conta ativa). A
// rota /contas continua funcionando por compatibilidade, mas não tem
// mais link no menu — o caminho natural é por aqui.
export default function Configuracoes() {
  // Troca de senha: usa a SESSÃO atual (não pede a senha antiga — quem
  // está logado é o dono). updateUser está disponível para o usuário
  // autenticado; é a mesma API que o dashboard do Supabase usa.
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
        <h2>Configurações</h2>
        <ul style={estilosComuns.lista}>
          <li style={estilosComuns.item}>
            <div>
              <span style={estilosComuns.nomeConta}>Relatórios</span>
              <span style={estilosComuns.tipoConta}>Análises por período e categoria</span>
            </div>
            <Link to="/relatorios" style={estilosComuns.link}>Abrir</Link>
          </li>
          <li style={estilosComuns.item}>
            <div>
              <span style={estilosComuns.nomeConta}>Ponto Inteligente</span>
              <span style={estilosComuns.tipoConta}>Jornada e horas a receber</span>
            </div>
            <Link to="/ponto" style={estilosComuns.link}>Abrir</Link>
          </li>
        </ul>
      </section>

      <section style={estilosComuns.secao}>
        <h2>Segurança</h2>
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
          <button type="submit" disabled={enviando} style={estilosComuns.botaoCriar}>
            {enviando ? 'Salvando...' : 'Trocar senha'}
          </button>
        </form>
        {mensagem && (
          <p style={mensagem.tipo === 'ok' ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>
            {mensagem.texto}
          </p>
        )}
      </section>

      <section style={estilosComuns.secao}>
        <h2>Minhas Contas</h2>
        <Contas />
      </section>

      <CartoesConfig />

      <section style={estilosComuns.secao}>
        <h2>Sessão</h2>
        <p style={estilosComuns.mensagem}>
          Você está logado(a). Use o botão <strong>Sair</strong> no cabeçalho para encerrar a
          sessão.
        </p>
      </section>
    </div>
  )
}