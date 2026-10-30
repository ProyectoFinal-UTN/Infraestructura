import { expect } from "@playwright/test";

/**
 * Page object del historial de compras de un proveedor
 * (`/proveedores/:id/compras`, HU-21).
 *
 * A diferencia de `proveedores.js` y `historial.js`, que van por rol y etiqueta,
 * aca casi todo va por `data-testid`. No es un descuido ni una comodidad: la
 * pantalla tiene cinco estados excluyentes —vacio, pagina vacia, error, sin
 * proveedor, cargando— que se distinguen entre si SOLO por el testid. Sus copys
 * son frases en castellano pensadas para el comerciante («Esa página ya no tiene
 * compras.»), y atar los tests a ellas significaria que cambiar una palabra
 * rompe la suite sin que nada se haya roto de verdad.
 *
 * Las dos excepciones:
 *
 * - El titulo, que va por rol: el contrato dice "heading nivel 1 con el nombre
 *   del proveedor", asi que el rol y el nivel SON lo que hay que verificar.
 * - Los mensajes de error, que el contrato declara mostrables: ahi el texto es
 *   parte de lo que se promete y se chequea por fragmento.
 *
 * Y ojo con los errores, que son DOS cosas distintas y es facil confundirlas:
 * `historial-compras-error` es el 400 del backend (y el error general), mientras
 * que el rango invertido lo frena el Frontend sin consultar y lo pinta pegado al
 * campo «Desde» (`#error-desde`). Un test del rango que buscara el testid
 * esperaria algo que nunca aparece.
 *
 * EL PUNTO FINO, y la razon de que este archivo tenga `vacio` y `paginaVacia`
 * como locators separados: son dos estados distintos a proposito y ninguno de
 * los dos es un error.
 *
 *   historial-compras-vacio        → no hay compras en el periodo (total 0)
 *   historial-compras-pagina-vacia → se pidio la pagina 99 y hay 1
 *                                    (total > 0, lista vacia)
 *
 * Ninguno lleva `role="alert"` (eso esta solo en `sin-proveedor` y en los
 * `error`). Entonces una asercion como «no hay ningun alert» pasa en el camino
 * feliz Y en estos dos, sin distinguirlos: seria decorativa. Por eso cada test
 * assertea el testid que espera Y la ausencia del otro.
 */
export class HistorialCompras {
  constructor(page) {
    this.page = page;

    this.contenedor = page.getByTestId("historial-compras");
    this.titulo = page.getByRole("heading", { level: 1 });
    this.volver = page.getByRole("link", { name: "← Volver a proveedores" });

    // Resumen del periodo. Las cuatro metricas son `resumen-${id}`, generadas
    // en un `.map` sobre compras|unidades|primera|ultima.
    this.resumen = page.getByTestId("historial-compras-resumen");
    this.resumenCompras = page.getByTestId("resumen-compras");
    this.resumenUnidades = page.getByTestId("resumen-unidades");
    this.resumenPrimera = page.getByTestId("resumen-primera");
    this.resumenUltima = page.getByTestId("resumen-ultima");

    // Filtros. `filtro-desde` y `filtro-hasta` son `<input type="date">`: se
    // completan con `fill("AAAA-MM-DD")`.
    this.desde = page.getByTestId("filtro-desde");
    this.hasta = page.getByTestId("filtro-hasta");
    this.limpiar = page.getByTestId("historial-compras-limpiar");

    // El rango invertido NO sale por `historial-compras-error`. Ese testid es
    // del 400 del backend; el rango al reves lo frena el Frontend sin consultar
    // y lo muestra anclado al campo «Desde», como el `<p id="error-desde">` de
    // `Campo.jsx` (mismo patron que `errorDeCampo` en `proveedores.js`).
    // Confundirlos haria que el test del rango buscara un testid que nunca
    // aparece.
    this.errorDeRango = page.locator("#error-desde");

    // Resultado.
    this.lista = page.getByTestId("historial-compras-lista");
    this.filas = page.getByTestId("compra-fila");

    // Los cinco estados excluyentes.
    this.cargando = page.getByTestId("historial-compras-cargando");
    this.vacio = page.getByTestId("historial-compras-vacio");
    this.paginaVacia = page.getByTestId("historial-compras-pagina-vacia");
    this.error = page.getByTestId("historial-compras-error");
    this.sinProveedor = page.getByTestId("historial-compras-sin-proveedor");

    // Badges de baja logica.
    this.proveedorDadoDeBaja = page.getByTestId("proveedor-dado-de-baja");
    this.productosDadosDeBaja = page.getByTestId("producto-dado-de-baja");

    // Paginacion: solo se dibuja con `totalPaginas > 1`.
    this.paginacion = page.getByTestId("historial-compras-paginacion");
    this.anterior = page.getByTestId("pagina-anterior");
    this.siguiente = page.getByTestId("pagina-siguiente");
    this.paginaActual = page.getByTestId("pagina-actual");
  }

  /** Entra a la pantalla de ese proveedor, opcionalmente con query. */
  async ir(proveedorId, query = "") {
    await this.page.goto(`/proveedores/${proveedorId}/compras${query}`);
    await this.esperarCarga();
  }

  /**
   * Espera a que la pantalla termine de cargar.
   *
   * Contra `aria-busy="false"` del contenedor y no contra la ausencia del cartel
   * «Cargando…»: el cartel solo existe en la primera carga, asi que al cambiar
   * un filtro —cuando ya hay datos en pantalla— no aparece, y esperarlo no
   * esperaria nada. `aria-busy` lo marca el contenedor en los dos casos.
   */
  async esperarCarga() {
    await expect(this.contenedor).toHaveAttribute("aria-busy", "false");
  }

  /** La fila de una compra, por su id (`data-compra-id`). */
  fila(compraId) {
    return this.page.locator(`[data-compra-id="${compraId}"]`);
  }

  /**
   * La cantidad de una fila, por su `aria-label` («12 unidad»).
   *
   * Por el label y no por el texto visible, por dos razones:
   *
   * 1. Un `toContainText("12")` sobre la fila entera tambien matchearia la fecha
   *    («12/10/2026») o la hora («12:30»).
   * 2. El `<p>` de la cantidad NO dice solo el numero: es
   *    `{cantidad}<span>{unidadMedida}</span>`, asi que su `textContent` sale
   *    pegado, «12unidad». Asertar ese string seria atarse al markup.
   *
   * El label resuelve las dos: es exacto y es lo que la pantalla promete —el
   * nombre accesible del dato, lo que anuncia un lector de pantalla—. Y como se
   * busca por nombre exacto, el locator ES la asercion: con otra cantidad no
   * encuentra nada, asi que basta con `toBeVisible()`.
   */
  cantidadDe(compraId, { cantidad, unidadMedida = "unidad" }) {
    return this.fila(compraId).getByLabel(`${cantidad} ${unidadMedida}`, {
      exact: true,
    });
  }

  /** Los ids que la pantalla esta mostrando, en el orden en que los pinta. */
  idsVisibles() {
    return this.filas.evaluateAll((filas) =>
      filas.map((fila) => fila.getAttribute("data-compra-id")),
    );
  }

  /**
   * Aplica un periodo por los filtros de la pantalla y espera el refetch.
   *
   * Los filtros viven en la URL, asi que se espera a que la URL los tenga antes
   * de mirar el resultado: sin eso se podria asertar sobre la lista anterior.
   */
  async filtrarPorPeriodo({ desde, hasta }) {
    await this.desde.fill(desde);
    await this.hasta.fill(hasta);

    await expect(this.page).toHaveURL(new RegExp(`desde=${desde}`));
    await expect(this.page).toHaveURL(new RegExp(`hasta=${hasta}`));
    await this.esperarCarga();
  }

  /**
   * Que dia es un instante PARA EL NAVEGADOR, como "AAAA-MM-DD".
   *
   * Tiene que resolverse adentro de la pagina y no en Node, y es la trampa
   * central de esta HU. El filtro es un `<input type="date">` que entrega un
   * dia, y el Frontend lo convierte al primer/ultimo instante de ese dia en la
   * hora local DEL NAVEGADOR (`inicioDelDia`/`finDelDia`). `timezoneId` de
   * playwright.config.js fija la zona del navegador, no la de Node: un dia
   * calculado aca con `new Date()` saldria en la zona del sistema operativo y
   * podria no ser el mismo. Una compra de las 22 h se iria un dia.
   *
   * `en-CA` es el locale que formatea ISO (`2026-10-28`); es el mismo recurso
   * que usa `fechasDelNavegador` en historial.spec.js (HU-14).
   */
  diaDe(iso) {
    return this.page.evaluate(
      (valor) => new Date(valor).toLocaleDateString("en-CA"),
      iso,
    );
  }
}
