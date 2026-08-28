// Envuelve el contenido de una tela.
//
// ANTES (Etapas 09/13): en desktop medía el contenido real y aplicaba
// transform: scale() para caber la viewport sin rolag de página. Eso
// hacía cada tela escalar de forma distinta según su contenido → fuentes
// de tamaños inconsistentes y páginas que no llenaban el espacio.
//
// AHORA: el comportamiento es UNIFORME en todas las resoluciones, igual
// al móvil desde la Etapa 13 — sin scale(). El contenido fluye a tamaño
// real (fonte base 1rem) y la página rola cuando excede la viewport; las
// listas largas son las que rolan internamente (max-height + overflow).
//
// Se mantiene la API (props maxLargura / alinhamento / rolagem / children)
// para no quebrar los imports existentes. `maxLargura` centraliza el
// contenido con esa anchura máxima (margin auto); `alinhamento` y
// `rolagem` quedan aceptados pero ya no cambian el comportamiento.
export default function CaberNaTela({ children, maxLargura = 480 }) {
  return (
    <div style={{ width: '100%', maxWidth: maxLargura, margin: '0 auto' }}>
      {children}
    </div>
  )
}
