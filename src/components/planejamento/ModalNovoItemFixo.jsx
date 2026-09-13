import { useState } from 'react'
import ModalFormulario from '../ModalFormulario'
import { estilosComuns } from '../../lib/compartilhados'

// ============================================================================
// MODAL "NOVO ITEM FIXO DO CONDOMÍNIO" — extraído do GeradorCondominio
// (13/09/2026) para ser reutilizado também pelo form de consumo real da
// ocorrência (atalho "Reajustar item fixo"). A LÓGICA DE VIGÊNCIA NÃO mora
// aqui: o pai passa `aoCadastrar(payload)` que termina no `criarItem` do hook
// useDespesaRecorrenteItens (única implementação — fecha a linha anterior do
// mesmo cod na véspera do novo início e preserva o histórico).
// ============================================================================

// Lê um número digitado ("124,08" ou "124.08") → número em reais (padrão app).
function lerValor(texto) {
  const n = Number(String(texto).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

export default function ModalNovoItemFixo({ aoCadastrar, aoFechar }) {
  const [itemForm, setItemForm] = useState({
    cod: '', descricao: '', valor: '', categoria: '', vigencia_inicio: '', vigencia_termino: '',
  })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function aoSalvar(e) {
    e.preventDefault()
    if (salvando) return
    try {
      setSalvando(true)
      setErro('')
      await aoCadastrar({
        cod: itemForm.cod,
        descricao: itemForm.descricao,
        valor: lerValor(itemForm.valor),
        categoria: itemForm.categoria,
        vigencia_inicio: itemForm.vigencia_inicio,
        vigencia_termino: itemForm.vigencia_termino || null,
      })
    } catch (err) {
      setErro(err.message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <ModalFormulario
      titulo="Novo item fixo do condomínio"
      aoFechar={() => {
        if (!salvando) aoFechar()
      }}
    >
      <form onSubmit={aoSalvar} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }} noValidate>
        <div style={estilos.grade}>
          <label style={estilos.rotuloCampo}>
            Código
            <input
              style={estilosComuns.input}
              placeholder="1002"
              value={itemForm.cod}
              onChange={(e) => setItemForm((f) => ({ ...f, cod: e.target.value }))}
            />
          </label>
          <label style={estilos.rotuloCampo}>
            Valor (R$)
            <input
              style={estilosComuns.input}
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={itemForm.valor}
              onChange={(e) => setItemForm((f) => ({ ...f, valor: e.target.value }))}
            />
          </label>
          <label style={{ ...estilos.rotuloCampo, gridColumn: '1 / -1' }}>
            Descrição
            <input
              style={estilosComuns.input}
              placeholder="Cota Condominial"
              value={itemForm.descricao}
              onChange={(e) => setItemForm((f) => ({ ...f, descricao: e.target.value }))}
            />
          </label>
          <label style={{ ...estilos.rotuloCampo, gridColumn: '1 / -1' }}>
            Categoria (opcional)
            <input
              style={estilosComuns.input}
              placeholder="Cota Regular"
              value={itemForm.categoria}
              onChange={(e) => setItemForm((f) => ({ ...f, categoria: e.target.value }))}
            />
          </label>
          <label style={estilos.rotuloCampo}>
            Início da vigência
            <input
              style={estilosComuns.input}
              type="date"
              value={itemForm.vigencia_inicio}
              onChange={(e) => setItemForm((f) => ({ ...f, vigencia_inicio: e.target.value }))}
            />
          </label>
          <label style={estilos.rotuloCampo}>
            Fim da vigência (opcional — série com contador)
            <input
              style={estilosComuns.input}
              type="date"
              value={itemForm.vigencia_termino}
              onChange={(e) => setItemForm((f) => ({ ...f, vigencia_termino: e.target.value }))}
            />
          </label>
        </div>

        {erro && <p style={estilosComuns.mensagemErro}>{erro}</p>}

        <button type="submit" disabled={salvando} style={salvando ? { ...estilosComuns.botaoCriar, opacity: 0.6 } : estilosComuns.botaoCriar}>
          {salvando ? 'Salvando...' : 'Cadastrar item fixo'}
        </button>
      </form>
    </ModalFormulario>
  )
}

const estilos = {
  grade: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' },
  rotuloCampo: { display: 'flex', flexDirection: 'column', gap: '0.25rem', color: '#9ca3af', fontSize: '0.8rem' },
}