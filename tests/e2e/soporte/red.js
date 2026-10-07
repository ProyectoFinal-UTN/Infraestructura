/**
 * Observacion de la red que sale del navegador.
 *
 * No es un page object: no ubica nada en la pantalla. Es lo que permite
 * distinguir dos comportamientos que se ven identicos desde la interfaz —el
 * formulario freno el envio, o el backend lo rechazo y la pantalla muestra ese
 * rechazo—. Sin contar los pedidos, un test de validacion en el cliente pasa en
 * verde aunque la validacion no exista.
 *
 * Vive aparte porque ya lo necesitan dos pantallas (el ajuste por fila de HU-11 y
 * la transferencia de HU-12) y la unica diferencia entre los dos casos era la
 * ruta.
 */

/**
 * Acumula los pedidos que dispara la pagina a una ruta, desde que se llama.
 *
 * Devuelve el array vivo: se lee despues de ejercitar el flujo, no en el momento.
 * Por eso tiene que engancharse ANTES del `goto`, o se pierden los pedidos de la
 * carga inicial — que en HU-27 son justamente los que interesan.
 *
 * La comparacion es sobre el `pathname` y no sobre la URL completa para que un
 * query string no haga fallar el filtro en silencio. En HU-27 eso no es
 * hipotetico: el endpoint acepta `?dias=`.
 */
export function contarPedidos(page, ruta, metodo = "POST") {
  const pedidos = [];

  page.on("request", (peticion) => {
    if (
      peticion.method() === metodo &&
      new URL(peticion.url()).pathname === ruta
    ) {
      pedidos.push(peticion.url());
    }
  });

  return pedidos;
}

/** Los POST a una ruta. Es la forma en que lo usan HU-11, HU-12 y HU-15. */
export function contarPosteos(page, ruta) {
  return contarPedidos(page, ruta, "POST");
}

/** Los POST a `/api/transferencias` (HU-12). */
export function contarPosteosDeTransferencia(page) {
  return contarPosteos(page, "/api/transferencias");
}

/**
 * Los GET a `/api/asistente/recomendaciones` (HU-27).
 *
 * Sirve para las dos preguntas que la pantalla no puede responder sola:
 *
 * - Que el empleado no dispare NINGUNA llamada. Sin esto, "no se ve la seccion"
 *   se cumpliria igual si la pantalla pidiera los datos, recibiera un 403 y
 *   escondiera el resultado — que es otra cosa, y peor.
 * - Que el boton «Actualizar» vuelva a pedir de verdad. Es el unico ancla
 *   honesto del refresco: el resumen esta cacheado 10 minutos del lado del
 *   servidor y la hora se muestra con precision de minutos, asi que ninguno de
 *   los dos cambia por hacer clic.
 */
export function contarPedidosDeRecomendaciones(page) {
  return contarPedidos(page, "/api/asistente/recomendaciones", "GET");
}
