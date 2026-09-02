import { useState } from 'react'
import { estilosComuns } from '../lib/compartilhados'
import ConfiguracoesContas from '../components/configuracoes/ConfiguracoesContas'
import ConfiguracoesCartao from '../components/configuracoes/ConfiguracoesCartao'
import ConfiguracoesPonto from '../components/configuracoes/ConfiguracoesPonto'
import ConfiguracoesGeral from '../components/configuracoes/ConfiguracoesGeral'

// Configurações em sub-abas (esqueleto de Tela 20): Contas, Cartão, Ponto e
// Geral. As abas usam o mesmo padrão visual de pill do módulo Cartões
// (Fatura/Extrato): a aba ativa é preenchida em azul #42A5F5.
//
// Cada aba puxa os dados REAIS do banco (useContas, useCartoes, PontoConfig),
// em vez de menus mockados do esqueleto. Itens sem backend (PIN/biometria/
// timeout, carga horária) são exibidos como leitura/desabilitados, conforme
// combinado — nada inventado.
const ABAS = [
  { chave: 'contas', rotulo: 'Contas' },
  { chave: 'cartao', rotulo: 'Cartão' },
  { chave: 'ponto', rotulo: 'Ponto' },
  { chave: 'geral', rotulo: 'Geral' },
]

export default function Configuracoes() {
  const [aba, setAba] = useState('contas')

  return (
    <div style={estilosComuns.conteudo}>
      <section style={estilosComuns.secao}>
        <h2>Configurações</h2>
        <p style={estilosComuns.mensagem}>
          Suas contas, cartões, definições do Ponto Inteligente e preferências
          gerais, tudo em um só lugar.
        </p>
      </section>

      <div style={estilos.abas}>
        {ABAS.map((a) => (
          <button
            key={a.chave}
            type="button"
            onClick={() => setAba(a.chave)}
            style={aba === a.chave ? estilos.abaAtiva : estilos.aba}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      {aba === 'contas' && <ConfiguracoesContas />}
      {aba === 'cartao' && <ConfiguracoesCartao />}
      {aba === 'ponto' && <ConfiguracoesPonto />}
      {aba === 'geral' && <ConfiguracoesGeral />}
    </div>
  )
}

const estilos = {
  abas: { display: 'flex', gap: '0.6rem', marginBottom: '1.4rem' },
  aba: {
    flex: 1,
    padding: '0.95rem 0.5rem',
    borderRadius: '12px',
    border: '1px solid #374151',
    background: '#0b0f19',
    color: '#9ca3af',
    cursor: 'pointer',
    fontWeight: 'bold',
    fontFamily: 'inherit',
    fontSize: '1.05rem',
  },
  abaAtiva: {
    flex: 1,
    padding: '0.95rem 0.5rem',
    borderRadius: '12px',
    border: '1px solid #42A5F5',
    background: '#42A5F5',
    color: '#0b0f19',
    cursor: 'pointer',
    fontWeight: 'bold',
    fontFamily: 'inherit',
    fontSize: '1.05rem',
  },
}
