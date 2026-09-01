import { useState } from 'react'
import { estilosComuns, hoje } from '../lib/compartilhados'
import { RÓTULO_TIPO } from './planejamento/comum'
import { montarAlteracoesEdicao } from '../lib/edicaoPlanejamento'
import ModalFormulario from './ModalFormulario'

// ============================================================================
// FORMULÁRIO DE EDIÇÃO DE UM PLANEJAMENTO (aberto pelo lápis "Editar" da linha)
// ============================================================================
// Problema 2 do andaime 01/09/2026: antes a edição só trocava o DESTINO
// (Conta/Cartão). Agora é um formulário COMPLETO no padrão de EditarCompraForm,
// pré-preenchido com o que o lançamento já registra:
//   • descrição;
//   • valor (texto com vírgula decimal, mesmo formato do "Lançar");
//   • data prevista;
//   • tipo Entrada/Saída;
//   • destino padrão Conta/Cartão (com os selects, como no modo criacao).
//
// Ao salvar, compara os campos com o original e envia SÓ os que mudaram —
// o hook `editarPlanejamento` é parcial (cada campo enviado é validado e
// gravado; campos não tocados nunca são sobrescritos; se data_prevista mudar,
// ano_semana/semana são recalculados no hook).
//
// ESCOPO definido com André (ver diário 01/09/2026):
//   • edição vale para a OCORRÊNCIA atual apenas — itens de série (recorrente/
//     parcelada com serie_id) NÃO propagam a mudança para as irmãs (propagar
//     seria via regenerarSerie, num passo futuro, já testado na lib);
//   • itens de FATURA (item.fatura === true, real ou projetada) NUNCA chegam
//     aqui — são projeção dinâmica, sem ações de edição;
//   • itens CANCELADOS também não exibem o botão (não-editáveis);
//   • para itens JÁ REALIZADOS a edição continua permitida (mesma regra do
//     direcionamento atual): atualizar a anotação de um lançamento efetivado.
//
// Props:
//   - item: { id, tipo_op, descricao, valor, data_prevista, destino_padrao,
//             cartao_padrao_id, serie_id, estado, ... } do planejamento.
//   - aoSalvar: async (alteracoes) => void — chama acoes.editar(id, alteracoes).
//   - contas: contas ativas disponíveis (select de destino).
//   - cartoes: cartões disponíveis (select de destino quando cartão).
//   - aoCancelar: fecha o formulário (X, Cancelar, Esc ou overlay).
// ============================================================================

function lerValor(texto) {
  const n = Number(String(texto).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

export default function EditarPlanejamentoForm({ item, aoSalvar, contas, cartoes, aoCancelar }) {
  const initialDestino = item.destino_padrao === 'cartao' ? 'cartao' : 'conta'

  const [descricao, setDescricao] = useState(item.descricao ?? '')
  const [tipoOp, setTipoOp] = useState(item.tipo_op ?? 'Saida')
  const [valor, setValor] = useState(item.valor != null ? String(item.valor).replace('.', ',') : '')
  const [dataPrevista, setDataPrevista] = useState(item.data_prevista ?? hoje())
  const [destino, setDestino] = useState(initialDestino)
  const [contaId, setContaId] = useState(item.conta_destino_id ?? (contas?.[0]?.id ?? ''))
  const [cartaoId, setCartaoId] = useState(
    item.cartao_padrao_id ?? (cartoes?.[0]?.id ?? ''),
  )
  const [enviando, setEnviando] = useState(false)
  const [mensagem, setMensagem] = useState(null)

  async function handleSalvar(e) {
    e.preventDefault()
    if (enviando) return
    const desc = descricao.trim()
    if (!desc) {
      setMensagem({ tipo: 'erro', texto: 'Informe a descrição.' })
      return
    }
    const valorNum = lerValor(valor)
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      setMensagem({ tipo: 'erro', texto: 'Informe um valor maior que zero.' })
      return
    }
    if (!dataPrevista) {
      setMensagem({ tipo: 'erro', texto: 'Informe a data prevista.' })
      return
    }
    if (destino === 'cartao' && !cartaoId) {
      setMensagem({ tipo: 'erro', texto: 'Selecione o cartão de destino.' })
      return
    }

    // Só envia o que MUDOU (o hook editarPlanejamento é parcial) — função pura
    // testável em lib/edicaoPlanejamento.js. Campos não tocados não são
    // enviados → nunca sobrescrevem o que já estava gravado.
    const alteracoes = montarAlteracoesEdicao({
      item,
      descricao: desc,
      valor: valorNum,
      dataPrevista,
      tipoOp,
      destino,
      contaId,
      cartaoId,
    })

    if (Object.keys(alteracoes).length === 0) {
      setMensagem({ tipo: 'ok', texto: 'Nenhuma alteração detectada.' })
      return
    }

    setEnviando(true)
    setMensagem(null)
    try {
      await aoSalvar(item.id, alteracoes)
      aoCancelar()
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err.message })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <ModalFormulario titulo="Editar planejamento" aoFechar={aoCancelar}>
      <form onSubmit={handleSalvar} style={{ ...estilosComuns.form, maxWidth: '100%' }} noValidate>
        <input
          type="text"
          placeholder="Descrição"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          maxLength={200}
          style={estilosComuns.input}
        />

        <div style={estilos.grade}>
          <input
            type="text"
            inputMode="decimal"
            placeholder="Valor (R$)"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            style={estilosComuns.input}
          />
          <input
            type="date"
            value={dataPrevista}
            onChange={(e) => setDataPrevista(e.target.value)}
            style={estilosComuns.input}
          />
        </div>

        <div style={estilos.grade}>
          <label style={estilos.rotuloCampo}>
            Tipo
            <select
              style={estilosComuns.input}
              value={tipoOp}
              onChange={(e) => setTipoOp(e.target.value)}
            >
              <option value="Entrada">Entrada</option>
              <option value="Saida">{RÓTULO_TIPO('Saida')}</option>
            </select>
          </label>

          <label style={estilos.rotuloCampo}>
            Destino padrão
            <select
              style={estilosComuns.input}
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
            >
              <option value="conta">Conta</option>
              <option value="cartao">Cartão</option>
            </select>
          </label>
        </div>

        {destino === 'cartao' ? (
          <label style={estilos.rotuloCampo}>
            Cartão de destino
            <select
              style={estilosComuns.input}
              value={cartaoId}
              onChange={(e) => setCartaoId(e.target.value)}
            >
              <option value="" disabled>
                Selecionar cartão
              </option>
              {cartoes.map((c) => (
                <option key={c.id} value={c.id}>
                  {`${c.nome}${c.contas?.nome ? ` (${c.contas.nome})` : ''}`}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label style={estilos.rotuloCampo}>
            Conta de destino (opcional)
            <select
              style={estilosComuns.input}
              value={contaId}
              onChange={(e) => setContaId(e.target.value)}
            >
              <option value="">Sem conta específica</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
        )}

        {item.serie_id && (
          <p style={estilos.notaSerie}>
            Este item pertence a uma série. A edição vale só para esta ocorrência —
            as demais parcelas não são alteradas.
          </p>
        )}

        <button type="submit" disabled={enviando} style={estilos.botaoSalvar}>
          {enviando ? 'Salvando...' : 'Salvar alterações'}
        </button>

        {mensagem && (
          <p
            style={
              mensagem.tipo === 'ok'
                ? estilosComuns.mensagemOk
                : estilosComuns.mensagemErro
            }
          >
            {mensagem.texto}
          </p>
        )}
      </form>
    </ModalFormulario>
  )
}

const estilos = {
  grade: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' },
  rotuloCampo: { display: 'flex', flexDirection: 'column', gap: '0.25rem', color: '#9ca3af', fontSize: '0.8rem' },
  notaSerie: { color: '#9ca3af', fontSize: '0.8rem', margin: 0 },
  botaoSalvar: {
    padding: '0.6rem',
    borderRadius: '8px',
    border: 'none',
    background: '#42A5F5',
    color: '#0b0f19',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
}