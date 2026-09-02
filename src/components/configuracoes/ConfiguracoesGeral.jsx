import { Link } from 'react-router-dom'
import { estilosComuns } from '../../lib/compartilhados'

// Aba "Geral" da tela de Configurações (em sub-abas).
//
// PIN/biometria e timeout de inatividade NÃO têm implementação no app (não há
// tabela nem lógica — foram removidos em leva anterior). Por decisão do André,
// eles aparecem como cards DESABILITADOS ("em breve"), apenas informativos,
// sem nenhuma ação real por trás. "Trocar senha" é a item funcional, apontando
// para a rota /configuracoes/senha (TrocarSenha) já existente.
export default function ConfiguracoesGeral() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <section style={estilosComuns.secao}>
        <h2 style={{ margin: '0 0 0.5rem' }}>Segurança</h2>

        <div style={{ ...estilos.card, ...estilos.desabilitado }}>
          <div style={estilos.cardTopo}>
            <span style={estilos.titulo}>PIN de acesso</span>
            <span style={estilos.seloEmBreve}>em breve</span>
          </div>
          <p style={estilos.descricao}>
            Criar um PIN para abrir o app. Indisponível nesta versão.
          </p>
        </div>

        <div style={{ ...estilos.card, ...estilos.desabilitado }}>
          <div style={estilos.cardTopo}>
            <span style={estilos.titulo}>Biometria</span>
            <span style={estilos.seloEmBreve}>em breve</span>
          </div>
          <p style={estilos.descricao}>
            Liberar o app com a digital ou reconhecimento facial. Indisponível
            nesta versão.
          </p>
        </div>

        <div style={{ ...estilos.card, ...estilos.desabilitado }}>
          <div style={estilos.cardTopo}>
            <span style={estilos.titulo}>Timeout de inatividade</span>
            <span style={estilos.seloEmBreve}>em breve</span>
          </div>
          <p style={estilos.descricao}>
            Bloquear o app após um período sem uso. Indisponível nesta versão.
          </p>
        </div>

        <div style={estilos.card}>
          <div style={estilos.cardTopo}>
            <span style={estilos.titulo}>Trocar senha</span>
          </div>
          <p style={estilos.descricao}>
            Atualizar a senha da sua conta (autenticação do app).
          </p>
          <Link to="/configuracoes/senha" style={estilosComuns.link}>
            Trocar senha →
          </Link>
        </div>
      </section>
    </div>
  )
}

const estilos = {
  card: {
    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: '12px',
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem',
  },
  cardTopo: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' },
  titulo: { fontWeight: 'bold', color: '#e5e7eb', padding: '0.4rem 0' },
  descricao: { color: '#9ca3af', fontSize: '0.85rem', margin: 0, lineHeight: 1.4 },
  seloEmBreve: {
    fontSize: '0.7rem',
    fontWeight: 'bold',
    color: '#9ca3af',
    border: '1px dashed #4b5563',
    borderRadius: '999px',
    padding: '0.15rem 0.6rem',
    whiteSpace: 'nowrap',
  },
  desabilitado: { opacity: 0.7 },
}
