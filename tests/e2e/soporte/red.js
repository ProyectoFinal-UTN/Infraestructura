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
 * Acumula los POST que dispara la pagina a una ruta, desde que se llama.
 *
 * Devuelve el array vivo: se lee despues de ejercitar el flujo, no en el momento.
 * La comparacion es sobre el `pathname` y no sobre la URL completa para que un
 * query string no haga fallar el filtro en silencio.
 */
export function contarPosteos(page, ruta) {
  const posteos = [];

  page.on("request", (peticion) => {
    if (
      peticion.method() === "POST" &&
      new URL(peticion.url()).pathname === ruta
    ) {
      posteos.push(peticion.url());
    }
  });

  return posteos;
}

/** Los POST a `/api/transferencias` (HU-12). */
export function contarPosteosDeTransferencia(page) {
  return contarPosteos(page, "/api/transferencias");
}
