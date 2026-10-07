import { expect } from "@playwright/test";

/**
 * Page object de «Sugerencias para tu negocio» (HU-27, RF6).
 *
 * No es una pantalla: es una seccion del Inicio, arriba del banner del
 * asistente de HU-26. Por eso `ir()` entra a `/` y no a una ruta propia.
 *
 * Va por `data-testid` como `accesos.js` y por el mismo motivo: la mitad de las
 * aserciones de esta HU son sobre presencia o ausencia de una tarjeta, y para
 * eso un identificador estable es mas honesto que un texto que cambia con la
 * redaccion. Los textos de `texto` y `porQue` son plantillas del backend y van a
 * cambiar; no se afirma sobre ellos en ningun lado.
 *
 * TRES COLISIONES QUE ESTE ARCHIVO EVITA, Y QUE NO SE PUEDEN REDESCUBRIR MAS
 * TARDE PORQUE EL SINTOMA NO APUNTA ACA
 *
 * 1. `soporte/asistente.js` busca el panel de HU-26 con
 *    `getByRole("region", { name: "Asistente" })` SIN `exact`, y Playwright
 *    matchea por substring. Esta seccion tambien es una `region` con nombre
 *    accesible, y vive en la MISMA pantalla que recorren `asistente.spec.js` y
 *    `modo-degradado.spec.js`. Hoy no chocan porque el `<h2>` dice «Sugerencias
 *    para tu negocio» y no menciona al asistente — es a proposito, no
 *    casualidad. Por eso aca la seccion se ancla por `getByTestId` y NUNCA por
 *    rol `region`: si alguien algun dia le mete «asistente» al titulo, lo que
 *    se rompe por strict mode son los specs de HU-26, no este.
 * 2. `Catalogo.linkVerStock()` (`catalogo.js:106`) es page-scoped, y el link de
 *    la tarjeta tiene a proposito el MISMO nombre accesible que el de la fila
 *    del catalogo. Reusar ese page object desde el Inicio es pedirle a
 *    Playwright que elija entre dos. Ver `linkVerStock()` abajo.
 * 3. Las tarjetas son `<li>`, y hasta HU-27 el Inicio no tenia NINGUN
 *    `listitem`. Contarlos page-wide —como hace `catalogo.js:93` en
 *    `/productos`— funcionaria hoy y se rompería en cuanto el Inicio sume otra
 *    lista. Todo conteo de aca va acotado al `<ul aria-label="Sugerencias">`.
 */

/** El texto de la carga inicial, con la elipsis de un caracter (U+2026). */
export const BUSCANDO = "Buscando sugerencias…";

export class Recomendaciones {
  constructor(page) {
    this.page = page;

    this.seccion = page.getByTestId("recomendaciones");

    // El titulo NO lleva la palabra «asistente», y eso es contrato de
    // convivencia con HU-26 (ver el punto 1 de arriba).
    this.titulo = page.getByRole("heading", {
      level: 2,
      name: "Sugerencias para tu negocio",
    });

    this.resumen = page.getByTestId("recomendaciones-resumen");
    this.generadoEn = page.getByTestId("recomendaciones-generado-en");
    this.avisoLimitado = page.getByTestId("recomendaciones-resumen-limitado");
    this.vacio = page.getByTestId("recomendaciones-vacio");
    this.cargando = page.getByText(BUSCANDO);

    // No existe hasta que llegaron los datos: antes no hay nada que refrescar.
    this.botonActualizar = page.getByTestId("recomendaciones-actualizar");

    // `exact` porque el `aria-label` del `<ul>` es exactamente «Sugerencias»,
    // y sin el tambien matchearia cualquier lista futura cuyo nombre lo
    // contenga. Acotado a la seccion, nunca a la pagina (punto 3).
    this.lista = this.seccion.getByRole("list", {
      name: "Sugerencias",
      exact: true,
    });

    /** Las tarjetas, acotadas a la lista. Es el conteo que vale. */
    this.tarjetas = this.lista.getByRole("listitem");
  }

  /**
   * Entra al Inicio y espera a que las sugerencias hayan llegado.
   *
   * El ancla es el RESUMEN y no la seccion ni el titulo, porque la seccion pasa
   * por dos estados intermedios y hay que atravesar los dos:
   *
   * - `Inicio.jsx` la monta recien con `resuelto && puede("asistente",
   *   "recomendaciones")`, asi que antes de que lleguen los permisos no esta en
   *   el DOM.
   * - Ya montada, muestra «Buscando sugerencias…» hasta que responde
   *   `GET /api/asistente/recomendaciones`.
   *
   * El `<p data-testid="recomendaciones-resumen">` solo se renderiza con
   * `datos` ya en mano, asi que verlo cubre los dos de una. Esperar el titulo no
   * serviría: se dibuja con la seccion, antes de que haya nada que leer.
   *
   * No sirve para el empleado: ahi la seccion no se monta nunca y esto
   * timeoutearia. Ese caso usa `Accesos.irAInicio()` y afirma ausencia.
   */
  async ir() {
    await this.page.goto("/");
    await expect(this.resumen).toBeVisible();
    await expect(this.cargando).toHaveCount(0);
  }

  /** La tarjeta de un tipo (`reponer`, `baja_rotacion`, `sin_historial`). */
  tarjeta(tipo) {
    return this.seccion.getByTestId(`recomendacion-${tipo}`);
  }

  /**
   * El link a la ficha del producto, DENTRO de la tarjeta.
   *
   * Acotado a la tarjeta y no a la pagina a proposito: el nombre accesible es
   * `Ver stock de <nombre>`, el mismo que usa la fila del catalogo —el Frontend
   * lo repite para no hacer aprender dos cosas— y `Catalogo.linkVerStock()` lo
   * busca page-scoped. Mientras el Inicio no muestre el catalogo no hay dos,
   * pero el dia que los muestre juntos esto seguiria apuntando al de la
   * tarjeta, que es el que esta HU promete.
   */
  linkVerStock(tipo, producto) {
    return this.tarjeta(tipo).getByRole("link", {
      name: `Ver stock de ${producto.nombre}`,
    });
  }

  /**
   * Refresca y espera a que el pedido haya ido y vuelto.
   *
   * La espera es por la RESPUESTA del endpoint, no por un estado del boton, y es
   * para no quedar entre dos carreras opuestas:
   *
   * - Esperar que el boton diga «Actualizando…» se cae cuando la respuesta
   *   llega rapido: el estado intermedio puede no existir el tiempo suficiente
   *   para verlo.
   * - Esperar que vuelva a decir «Actualizar» se cae del otro lado: apenas se
   *   hace clic, React todavia no re-renderizo, el boton SIGUE diciendo
   *   «Actualizar» y la asercion pasa sin que el refresco haya ocurrido.
   *
   * `waitForResponse` no tiene ninguno de los dos problemas. Y tampoco se puede
   * anclar en el contenido, que es la trampa de esta HU: el `resumen` esta
   * cacheado 10 minutos del lado del servidor —dos refrescos seguidos devuelven
   * el mismo parrafo— y la hora se muestra con precision de minutos, asi que dos
   * clics dentro del mismo minuto dan la misma hora. Las dos cosas son
   * correctas, y un test anclado ahi fallaria con el sistema funcionando bien.
   *
   * Que el refresco fue UN pedido y no cero ni tres se cuenta aparte, con
   * `contarPedidosDeRecomendaciones` en `soporte/red.js`.
   */
  async actualizar() {
    await Promise.all([
      this.page.waitForResponse(
        (respuesta) =>
          new URL(respuesta.url()).pathname === "/api/asistente/recomendaciones",
      ),
      this.botonActualizar.click(),
    ]);

    // Recien ahora el boton volvio a su estado de reposo. Si quedara en
    // «Actualizando…» o deshabilitado, el refresco dejo la pantalla trabada.
    await expect(this.botonActualizar).toHaveText("Actualizar");
    await expect(this.botonActualizar).toBeEnabled();
  }
}
