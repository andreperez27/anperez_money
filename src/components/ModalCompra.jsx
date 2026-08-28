import CompraForm from './CompraForm'
import ModalFormulario from './ModalFormulario'

// Modal centralizado para lançar compra/despesa no cartão.
//
// Encapsula o padrão visual aprovado (ModalFormulario) em torno do
// CompraForm. Falha em branco se o body não existir (SSR/teste).
//
// Props:
//   - aberto: controla a exibição.
//   - cartaoIdInicial: cartão pré-selecionado (vem de um cartão específico).
//   - aoFechar: fecha o modal (Cancelar, X, Esc ou clique no overlay).
//   - aoLancar: callback após uma compra bem-sucedida (atualiza tela);
//     o modal só fecha quando essa callback roda, então em erro do banco o
//     formulário permanece aberto com a mensagem visível.
//   - titulo: cabeçalho do modal (default "Lançar compra").
export default function ModalCompra({
  aberto,
  cartaoIdInicial = '',
  aoFechar,
  aoLancar,
  titulo = 'Lançar compra',
}) {
  return (
    <ModalFormulario
      aberto={aberto}
      titulo={titulo}
      aoFechar={aoFechar}
    >
      <CompraForm
        cartaoIdInicial={cartaoIdInicial}
        aoLancar={() => {
          if (aoLancar) aoLancar()
          aoFechar()
        }}
      />
    </ModalFormulario>
  )
}
