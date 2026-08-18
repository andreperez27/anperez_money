import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useContas } from '../hooks/useContas'
import { useMovimentacoes } from '../hooks/useMovimentacoes'
import { supabase } from '../lib/supabaseClient'

// Formata 1500.5 como "R$ 1.500,50".
const formatoReal = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

// "2026-08-18" vira "18/08/2026" na tela.
function formatarData(dataISO) {
  const [ano, mes, dia] = dataISO.split('-')
  return `${dia}/${mes}/${ano}`
}

function hoje() {
  return new Date().toISOString().slice(0, 10)
}

export default function Dashboard() {
  const { usuario } = useAuth()
  const { contas, carregando: contasCarregando, erro: contasErro, criarConta, atualizar } = useContas()
  const { movimentacoes, carregando: movCarregando, erro: movErro, criarMovimentacao } = useMovimentacoes()

  // --- Estado do formulário de nova conta ---
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState('corrente')
  const [saldo, setSaldo] = useState('')
  const [enviandoConta, setEnviandoConta] = useState(false)
  const [mensagemConta, setMensagemConta] = useState(null)

  // --- Estado do formulário de nova movimentação ---
  const [contaId, setContaId] = useState('')
  const [tipoOp, setTipoOp] = useState('Entrada')
  const [valor, setValor] = useState('')
  const [descricao, setDescricao] = useState('')
  const [categoria, setCategoria] = useState('')
  const [data, setData] = useState(hoje)
  const [enviandoMov, setEnviandoMov] = useState(false)
  const [mensagemMov, setMensagemMov] = useState(null)

  async function handleCriarConta(e) {
    e.preventDefault()
    setEnviandoConta(true)
    setMensagemConta(null)

    try {
      await criarConta({
        nome: nome.trim(),
        tipo,
        saldo_atual: Number(saldo) || 0,
      })
      setNome('')
      setSaldo('')
      setMensagemConta({ tipo: 'ok', texto: `Conta "${nome.trim()}" criada.` })
    } catch (err) {
      setMensagemConta({ tipo: 'erro', texto: `Não foi possível criar: ${err.message}` })
    } finally {
      setEnviandoConta(false)
    }
  }

  async function handleCriarMovimentacao(e) {
    e.preventDefault()
    setEnviandoMov(true)
    setMensagemMov(null)

    try {
      await criarMovimentacao({
        conta_id: contaId,
        data,
        descricao: descricao.trim(),
        valor: Number(valor),
        categoria: categoria.trim() || null,
        tipo_op: tipoOp,
      })
      // O trigger já ajustou o saldo no banco; atualizar() traz o novo
      // valor para a tela sem recarregar a página.
      await atualizar()
      setValor('')
      setDescricao('')
      setCategoria('')
      setMensagemMov({
        tipo: 'ok',
        texto: `${tipoOp === 'Entrada' ? 'Entrada' : 'Saída'} de ${formatoReal.format(Number(valor))} lançada.`,
      })
    } catch (err) {
      setMensagemMov({ tipo: 'erro', texto: `Não foi possível lançar: ${err.message}` })
    } finally {
      setEnviandoMov(false)
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  return (
    <div style={estilos.pagina}>
      <header style={estilos.cabecalho}>
        <h1 style={estilos.titulo}>anperez.money</h1>
        <div style={estilos.usuario}>
          <span>{usuario?.email}</span>
          <button onClick={handleLogout} style={estilos.botaoSair}>
            Sair
          </button>
        </div>
      </header>

      <main style={estilos.conteudo}>
        <section style={estilos.secao}>
          <h2>Nova conta</h2>
          <form onSubmit={handleCriarConta} style={estilos.form}>
            <input
              type="text"
              placeholder="Nome (ex.: Carteira)"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              style={estilos.input}
            />
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              style={estilos.input}
            >
              <option value="corrente">corrente</option>
              <option value="poupanca">poupança</option>
              <option value="carteira">carteira</option>
            </select>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="Saldo inicial (R$)"
              value={saldo}
              onChange={(e) => setSaldo(e.target.value)}
              style={estilos.input}
            />
            <button type="submit" disabled={enviandoConta} style={estilos.botaoCriar}>
              {enviandoConta ? 'Criando...' : 'Criar conta'}
            </button>
          </form>

          {mensagemConta && (
            <p style={mensagemConta.tipo === 'ok' ? estilos.mensagemOk : estilos.mensagemErro}>
              {mensagemConta.texto}
            </p>
          )}
        </section>

        <section style={estilos.secao}>
          <h2>Nova movimentação</h2>
          <form onSubmit={handleCriarMovimentacao} style={estilos.form}>
            <select
              value={contaId}
              onChange={(e) => setContaId(e.target.value)}
              required
              style={estilos.input}
            >
              <option value="" disabled>
                Selecione a conta...
              </option>
              {contas.map((conta) => (
                <option key={conta.id} value={conta.id}>
                  {conta.nome} — {formatoReal.format(Number(conta.saldo_atual))}
                </option>
              ))}
            </select>
            <select
              value={tipoOp}
              onChange={(e) => setTipoOp(e.target.value)}
              style={estilos.input}
            >
              <option value="Entrada">Entrada</option>
              <option value="Saida">Saída</option>
            </select>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              placeholder="Valor (R$)"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              style={estilos.input}
            />
            <input
              type="text"
              required
              placeholder="Descrição"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              style={estilos.input}
            />
            <input
              type="text"
              placeholder="Categoria (opcional)"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              style={estilos.input}
            />
            <input
              type="date"
              required
              value={data}
              onChange={(e) => setData(e.target.value)}
              style={estilos.input}
            />
            <button type="submit" disabled={enviandoMov} style={estilos.botaoCriar}>
              {enviandoMov ? 'Lançando...' : 'Lançar'}
            </button>
          </form>

          {mensagemMov && (
            <p style={mensagemMov.tipo === 'ok' ? estilos.mensagemOk : estilos.mensagemErro}>
              {mensagemMov.texto}
            </p>
          )}
        </section>

        <section style={estilos.secao}>
          <h2>Contas</h2>

          {contasCarregando && <p style={estilos.mensagem}>Carregando contas...</p>}

          {contasErro && (
            <p style={estilos.erro}>Não foi possível carregar suas contas: {contasErro}</p>
          )}

          {!contasCarregando && !contasErro && contas.length === 0 && (
            <p style={estilos.mensagem}>Nenhuma conta cadastrada ainda.</p>
          )}

          {!contasCarregando && !contasErro && contas.length > 0 && (
            <ul style={estilos.lista}>
              {contas.map((conta) => (
                <li key={conta.id} style={estilos.item}>
                  <div>
                    <span style={estilos.nomeConta}>{conta.nome}</span>
                    <span style={estilos.tipoConta}>{conta.tipo}</span>
                  </div>
                  <span style={estilos.saldo}>
                    {formatoReal.format(Number(conta.saldo_atual))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section style={estilos.secao}>
          <h2>Movimentações recentes</h2>

          {movCarregando && <p style={estilos.mensagem}>Carregando movimentações...</p>}

          {movErro && (
            <p style={estilos.erro}>Não foi possível carregar as movimentações: {movErro}</p>
          )}

          {!movCarregando && !movErro && movimentacoes.length === 0 && (
            <p style={estilos.mensagem}>Nenhuma movimentação ainda.</p>
          )}

          {!movCarregando && !movErro && movimentacoes.length > 0 && (
            <ul style={estilos.lista}>
              {movimentacoes.map((mov) => {
                const ehEntrada = mov.tipo_op === 'Entrada'
                return (
                  <li key={mov.id} style={estilos.item}>
                    <div>
                      <span style={estilos.nomeConta}>{mov.descricao}</span>
                      <span style={estilos.tipoConta}>
                        {formatarData(mov.data)} · {mov.contas?.nome ?? '—'}
                        {mov.categoria ? ` · ${mov.categoria}` : ''}
                      </span>
                    </div>
                    <span style={ehEntrada ? estilos.valorEntrada : estilos.valorSaida}>
                      {ehEntrada ? '+' : '−'} {formatoReal.format(Number(mov.valor))}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}

const estilos = {
  pagina: {
    minHeight: '100vh',
    fontFamily: 'sans-serif',
    background: '#0b0f19',
    color: '#e5e7eb',
  },
  cabecalho: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '1rem 2rem',
    borderBottom: '1px solid #1f2937',
  },
  titulo: { margin: 0, fontSize: '1.25rem' },
  usuario: { display: 'flex', alignItems: 'center', gap: '1rem' },
  botaoSair: {
    padding: '0.4rem 0.9rem',
    borderRadius: '8px',
    border: '1px solid #374151',
    background: 'none',
    color: '#e5e7eb',
    cursor: 'pointer',
  },
  conteudo: { padding: '2rem', maxWidth: '720px', margin: '0 auto' },
  secao: { marginBottom: '2rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '340px' },
  input: {
    padding: '0.6rem 0.8rem',
    borderRadius: '8px',
    border: '1px solid #374151',
    background: '#111827',
    color: '#e5e7eb',
  },
  botaoCriar: {
    padding: '0.6rem',
    borderRadius: '8px',
    border: 'none',
    background: '#42A5F5',
    color: '#0b0f19',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  mensagem: { color: '#9ca3af' },
  erro: { color: '#ef4444' },
  mensagemOk: { color: '#4ade80' },
  mensagemErro: { color: '#ef4444' },
  lista: { listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.9rem 1.1rem',
    borderRadius: '10px',
    background: '#111827',
    border: '1px solid #1f2937',
  },
  nomeConta: { fontWeight: 'bold' },
  tipoConta: { color: '#9ca3af', marginLeft: '0.6rem', fontSize: '0.85rem' },
  saldo: { fontWeight: 'bold', color: '#42A5F5' },
  valorEntrada: { fontWeight: 'bold', color: '#4ade80' },
  valorSaida: { fontWeight: 'bold', color: '#f87171' },
}