import { estilosComuns } from '../lib/compartilhados'
import { GRUPOS_CATEGORIAS, categoriaExiste } from '../lib/categorias'

// Seletor de categoria com as listas agrupadas por contexto (Entradas,
// Alimentação, Transporte, Casa, Pessoal, Outros gastos). Usado em todos os
// lançamentos (conta e cartão) para manter a categorização centralizada.
//
// Props:
//   - value/onChange: select controlado (value '' = sem categoria).
//   - obrigatorio: quando true exibe o placeholder "Selecione a categoria"
//     (disabled) e marca required; quando false a primeira opção é
//     "Sem categoria".
//   - estilo: estilos extras mesclados sobre estilosComuns.input.
export default function SeletorCategoria({ value, onChange, obrigatorio = false, estilo }) {
  // Se o valor gravado (ex.: categoria migrada da planilha) não está na
  // lista, inclui uma opção própria para que apareça selecionada e não se
  // perca na renderização.
  const temValorExterno = value && !categoriaExiste(value)

  return (
    <select
      value={value}
      onChange={onChange}
      required={obrigatorio}
      style={{ ...estilosComuns.input, ...estilo }}
    >
      {obrigatorio ? (
        <option value="" disabled>Selecione a categoria</option>
      ) : (
        <option value="">Sem categoria</option>
      )}

      {temValorExterno && <option value={value}>{value}</option>}

      {GRUPOS_CATEGORIAS.map((grupo) => (
        <optgroup key={grupo.nome} label={grupo.nome}>
          {grupo.categorias.map((categoria) => (
            <option key={categoria} value={categoria}>{categoria}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}