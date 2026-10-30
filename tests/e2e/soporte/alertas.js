import { expect } from "@playwright/test";

/**
 * Page object del panel de alertas del dashboard (HU-17).
 *
 * No es una pantalla: es un widget de `/` (`SeccionAlertas` dentro de
 * `pages/Inicio.jsx`), y solo se dibuja cuando la configuracion ya resolvio y
 * el rol tiene `alerta.read`. No hay ruta propia ni link de entrada, asi que
 * no hay un camino de navegacion que recorrer como el «Ver compras» de HU-21.
 *
 * Y por eso mismo LA PAGINA NO VIVE EN LA URL: es un `useState` del componente,
 * a proposito —«meterle un ?pagina=2 al dashboard ensucia una URL», dice el
 * Frontend—, y `pagina-siguiente` esta `disabled` en la ultima. O sea que un
 * `goto("/?pagina=99")` no provoca nada: el panel pide la pagina 1 igual. El
 * borde de contrato de la pagina inexistente se cubre por API en
 * `tests/api/alertas.spec.js`, donde si se puede.
 *
 * ---------------------------------------------------------------------------
 * LOS CUATRO PARES QUE SE PARECEN Y DICEN COSAS DISTINTAS
 *
 * Estan separados en locators propios por la misma razon que en
 * `historialCompras.js`: ninguno de los dos miembros de estos pares lleva
 * `role="alert"`, asi que una asercion como «no hay ningun alert» pasaria en
 * los dos sin distinguirlos, y seria decorativa. Cada test assertea el que
 * espera Y LA AUSENCIA DEL HERMANO.
 *
 *   alertas-vacio          → no hay nada que reponer (total 0)
 *   alertas-pagina-vacia   → si hay, pero esa pagina no existe (total > 0 y
 *                            lista vacia). NO es un error: gris, sin alert, y
 *                            con «Volver a la primera»
 *
 *   alerta-faltante        → «Faltan N unidad para el minimo»
 *   alerta-faltante-cero   → «Esta justo en el minimo». La fila APARECE igual:
 *                            alcanzar el umbral ya es estar en falta
 *
 *   alertas-ubicaciones    → el desglose de donde esta lo que queda
 *   alerta-sin-ubicaciones → no queda nada en ningun lado
 *
 *   alerta-proveedor-sugerido → a quien pedirle, con tel: y mailto:
 *   alerta-sin-proveedor      → el producto no tiene proveedor y la alerta
 *                               aparece igual
 *
 * Los tres ultimos pares viven ADENTRO de la fila, no en el panel, asi que sus
 * lectores se scopean al `<li>`. Un `page.getByTestId("alertas-ubicaciones")`
 * suelto encontraria el desglose de cualquier fila.
 */
export class PanelDeAlertas {
  constructor(page) {
    this.page = page;

    this.contenedor = page.getByTestId("alertas");
    this.lista = page.getByTestId("alertas-lista");
    this.filas = page.getByTestId("alerta-fila");

    // El contador dice «N productos para reponer», y «Actualizando…» mientras
    // carga. Solo existe cuando NO esta vacio.
    this.contador = page.getByTestId("alertas-contador");

    this.cargando = page.getByTestId("alertas-cargando");
    this.vacio = page.getByTestId("alertas-vacio");
    this.paginaVacia = page.getByTestId("alertas-pagina-vacia");
    this.error = page.getByTestId("alertas-error");

    this.paginacion = page.getByTestId("alertas-paginacion");
    this.anterior = page.getByTestId("pagina-anterior");
    this.siguiente = page.getByTestId("pagina-siguiente");
    this.paginaActual = page.getByTestId("pagina-actual");
  }

  /** Entra al dashboard y espera a que el panel termine de cargar. */
  async ir() {
    await this.page.goto("/");
    await this.esperarCarga();
  }

  /**
   * Espera a que el panel termine de cargar.
   *
   * Contra `aria-busy="false"` del contenedor, y NO contra la desaparicion de
   * `alertas-cargando`: ese cartel solo existe en la primera carga —se dibuja
   * con `!resultado`—, asi que cuando ya hay datos en pantalla no aparece y
   * esperarlo no esperaria nada.
   *
   * Y tampoco se espera un tick del refresco automatico: la cadencia es de 60 s
   * y el refresco de fondo NO mueve `aria-busy` a proposito, justamente para
   * que esta espera no sea intermitente. Con un timeout de 45 s no hay forma de
   * verlo, asi que los tests que necesitan datos nuevos recargan la pagina.
   */
  async esperarCarga() {
    await expect(this.contenedor).toHaveAttribute("aria-busy", "false");
  }

  /** La fila de un producto, por su `data-producto-id`. */
  fila(productoId) {
    return this.page.locator(`[data-producto-id="${productoId}"]`);
  }

  /**
   * El faltante de una fila, por su `aria-label`.
   *
   * Por el label y no por el texto visible, que es la trampa que ya documentamos
   * en HU-21: el `<p>` es `Faltan {n} {unidad} para el minimo` con el numero en
   * su propio nodo, asi que el `textContent` sale pegado. El label dice el dato
   * completo y es el nombre accesible —lo que anuncia un lector de pantalla—.
   *
   * Como se busca por nombre EXACTO, el locator ES la asercion: con otro
   * faltante no encuentra nada, asi que alcanza con `toBeVisible()`.
   *
   * Solo sirve para un faltante mayor que 0. El producto justo en el minimo usa
   * `faltanteCeroDe`, que es otro testid y no tiene label.
   */
  faltanteDe(productoId, { faltante, unidadMedida = "unidad" }) {
    return this.fila(productoId).getByLabel(
      `Faltan ${faltante} ${unidadMedida} para el mínimo`,
      { exact: true },
    );
  }

  /**
   * El «Esta justo en el minimo» de una fila.
   *
   * Sin label a diferencia de sus vecinos, porque no tiene ningun numero que
   * salga pegado: el texto visible ya dice todo. Se ubica por testid.
   */
  faltanteCeroDe(productoId) {
    return this.fila(productoId).getByTestId("alerta-faltante-cero");
  }

  /**
   * El stock vivo de una fila, por su `aria-label`.
   *
   * OJO, que es facil escribirlo mal: el label NO es «3 unidad» sino
   * «Te quedan 3 unidad, el minimo es 5». Lleva los dos numeros porque el
   * `textContent` sale pegado («Te quedan 3 unidad · minimo 5» con el 3 en un
   * `<strong>`). Como pide tambien el umbral, el locator verifica de una sola
   * vez los dos lados de la comparacion que genero la alerta.
   */
  stockDe(productoId, { stock, umbral, unidadMedida = "unidad" }) {
    return this.fila(productoId).getByLabel(
      `Te quedan ${stock} ${unidadMedida}, el mínimo es ${umbral}`,
      { exact: true },
    );
  }

  /** El desglose por ubicacion de una fila (o su ausencia, con `toHaveCount`). */
  ubicacionesDe(productoId) {
    return this.fila(productoId).getByTestId("alertas-ubicaciones");
  }

  /** Cada chip del desglose de una fila. */
  ubicacionesChipsDe(productoId) {
    return this.fila(productoId).getByTestId("alerta-ubicacion");
  }

  /**
   * Un renglon del desglose, por su `aria-label` («Depósito: 2 unidad»).
   *
   * Mismo criterio que `stockDe`: el texto visible es `{nombre} {cantidad}` con
   * la cantidad en un `<strong>`, asi que sale pegado. Y hay que verificar POR
   * UBICACION y no por el total: el total suma todas y taparia un movimiento
   * aplicado al estante equivocado.
   */
  ubicacionDe(productoId, { nombre, cantidad, unidadMedida = "unidad" }) {
    return this.fila(productoId).getByLabel(
      `${nombre}: ${cantidad} ${unidadMedida}`,
      { exact: true },
    );
  }

  sinUbicacionesDe(productoId) {
    return this.fila(productoId).getByTestId("alerta-sin-ubicaciones");
  }

  proveedorSugeridoDe(productoId) {
    return this.fila(productoId).getByTestId("alerta-proveedor-sugerido");
  }

  sinProveedorDe(productoId) {
    return this.fila(productoId).getByTestId("alerta-sin-proveedor");
  }

  otrosProveedoresDe(productoId) {
    return this.fila(productoId).getByTestId("alerta-otros-proveedores");
  }

  /** El «Bajo de X a Y desde el aviso», que solo aparece si empeoro. */
  bajoDesdeElAvisoDe(productoId) {
    return this.fila(productoId).getByTestId("alerta-bajo-desde-el-aviso");
  }

  generadaEnDe(productoId) {
    return this.fila(productoId).getByTestId("alerta-generada-en");
  }

  /** Los ids de producto que el panel esta mostrando, en el orden que los pinta. */
  idsVisibles() {
    return this.filas.evaluateAll((filas) =>
      filas.map((fila) => fila.getAttribute("data-producto-id")),
    );
  }
}
