import { expect } from "@playwright/test";

/**
 * Page object del detalle de stock de un producto (`/productos/:id`, HU-11).
 *
 * Mismo criterio que `catalogo.js` y `movimientos.js`: el Frontend no tiene
 * `data-testid`, asi que todo se ubica por rol, etiqueta y texto. Las trampas
 * propias de esta pantalla:
 *
 * - El formulario de ajuste **no tiene `aria-label`**, asi que no expone
 *   `role="form"` y no se puede buscar como en las otras dos pantallas. El
 *   ancla de todo es el `<li>` de la ubicacion.
 * - Los campos se repiten una vez por fila: hay tantos «Cantidad» y «Sentido»
 *   como ubicaciones tenga el comercio. Ninguna busqueda puede salir de la
 *   pagina; todas se acotan a la fila.
 * - Por eso mismo los ids llevan la ubicacion al final
 *   (`cantidad-<uuid>`, y su error `error-cantidad-<uuid>`). El test no conoce
 *   ese uuid, asi que el error se ancla por prefijo dentro de la fila.
 * - Ni la cantidad de la fila ni el total tienen rol propio: son un `<span>`
 *   hermano del nombre y del texto «Total». Se los ubica como tales en vez de
 *   afirmar sobre el texto del contenedor, que daria «Principal20».
 * - El error que devuelve el backend es un `<p>` sin rol ni id, hijo directo
 *   del `<li>`. Los de validacion, en cambio, viven dentro del formulario
 *   anclados a su campo: ese es el criterio que los separa.
 * - El `<li>` de stock es el unico de la pantalla (no hay Layout con nav), asi
 *   que `getByRole("listitem")` no matchea nada mas.
 */
export class DetalleProducto {
  /** @param producto el que devuelve `crearProductoViaApi` (necesita `id` y `nombre`). */
  constructor(page, producto) {
    this.page = page;
    this.producto = producto;

    this.titulo = page.getByRole("heading", { name: producto.nombre });
    this.volver = page.getByRole("link", { name: "← Volver a productos" });

    // El numero del total, no la fila entera.
    this.total = page
      .getByText("Total", { exact: true })
      .locator("xpath=following-sibling::span");

    this.sinUbicaciones = page.getByText(
      "Todavía no hay ubicaciones de stock configuradas para tu comercio.",
    );
    this.irAConfiguracion = page.getByRole("link", {
      name: "Ir a Configuración",
    });

    // El fallo de la carga de la pantalla (por ejemplo, el 404 de un producto
    // ajeno). No confundirlo con `errorDelBackend`, que es por fila.
    this.errorDeCarga = page.getByRole("alert");
  }

  /**
   * Entra directo por URL.
   *
   * Se espera el `<h1>` con el nombre y no el titulo generico: mientras carga,
   * el encabezado dice «Producto», asi que ver el nombre es la senal de que
   * `GET /api/productos/:id` ya volvio y el stock esta dibujado. Eso cubre de
   * una el «Cargando…» de la ruta protegida y el «Cargando datos…» de la
   * pantalla.
   */
  async ir() {
    await this.page.goto(`/productos/${this.producto.id}`);
    await expect(this.titulo).toBeVisible();
  }

  /**
   * Entra por el link «Ver stock» del catalogo, que es el camino real del
   * usuario. `ir()` es el atajo para los tests que ya no vienen a probar como
   * se llega.
   */
  async abrirDesde(catalogo) {
    await catalogo.linkVerStock(this.producto).click();
    await expect(this.titulo).toBeVisible();
  }

  /** La fila de una ubicacion, ubicada por su nombre. */
  fila(nombreUbicacion) {
    return this.page
      .getByRole("listitem")
      .filter({ hasText: nombreUbicacion });
  }

  /** Todas las filas de ubicacion, para contarlas o afirmar que no hay. */
  get filas() {
    return this.page.getByRole("listitem");
  }

  /** La cantidad que muestra la fila (el `<span>` hermano del nombre). */
  cantidadEn(nombreUbicacion) {
    return this.fila(nombreUbicacion)
      .getByText(nombreUbicacion, { exact: true })
      .locator("xpath=following-sibling::span");
  }

  botonAjustar(nombreUbicacion) {
    return this.fila(nombreUbicacion).getByRole("button", { name: "Ajustar" });
  }

  /**
   * Completa el ajuste de una fila y lo envia.
   *
   * El sentido se elige por `value` (`entrada`/`salida`) y no por la etiqueta
   * visible, igual que el tipo en `movimientos.js`: es el mismo string que
   * viaja al backend, asi que si alguien cambia el texto comercial el test no
   * se entera, que es lo correcto.
   *
   * Los campos son opcionales para poder mandar el formulario incompleto a
   * proposito y ver la validacion.
   */
  async ajustar(nombreUbicacion, { cantidad, sentido } = {}) {
    const fila = this.fila(nombreUbicacion);

    if (cantidad !== undefined) {
      await fila.getByLabel("Cantidad", { exact: true }).fill(String(cantidad));
    }
    if (sentido !== undefined) {
      await fila.getByLabel("Sentido", { exact: true }).selectOption(sentido);
    }

    await this.botonAjustar(nombreUbicacion).click();
  }

  /** El campo «Cantidad» de una fila, para verificar que se limpio. */
  campoCantidad(nombreUbicacion) {
    return this.fila(nombreUbicacion).getByLabel("Cantidad", { exact: true });
  }

  /**
   * Escribe la cantidad tecleando en vez de con `fill`.
   *
   * Hace falta para lo que no es un numero: `fill` sobre un
   * `<input type="number">` rechaza ese texto antes de tocar la pagina, asi que
   * el test nunca veria lo que hace el navegador con el. Tecleando se ejercita
   * lo mismo que hace una persona.
   */
  async escribirCantidad(nombreUbicacion, texto) {
    const campo = this.campoCantidad(nombreUbicacion);

    await campo.click();
    await campo.pressSequentially(texto);
  }

  /** El campo «Sentido» de una fila, para verificar que se limpio. */
  campoSentido(nombreUbicacion) {
    return this.fila(nombreUbicacion).getByLabel("Sentido", { exact: true });
  }

  /**
   * Error de validacion anclado a un campo de la fila.
   *
   * Se busca por el prefijo del id y no por el texto: asi la asercion prueba
   * ademas que el mensaje quedo asociado al campo (`aria-describedby`), que es
   * lo que hace que un lector de pantalla lo anuncie, y no solo que aparecio
   * en algun lado de la pantalla.
   */
  errorDeCampo(nombreUbicacion, campo) {
    return this.fila(nombreUbicacion).locator(`[id^="error-${campo}-"]`);
  }

  /**
   * El error que devuelve el backend para esa fila (por ejemplo, el 409 por
   * stock insuficiente). Es el unico `<p>` que cuelga directo del `<li>`: los
   * de validacion estan mas adentro, dentro del formulario.
   */
  errorDelBackend(nombreUbicacion) {
    return this.fila(nombreUbicacion).locator("> p");
  }
}

/**
 * Acumula los POST a `/api/movimientos` que dispara la pantalla desde que se
 * llama.
 *
 * Lo usa el test de validacion: «muestra el error» no alcanza para probar que
 * el ajuste invalido se freno en el navegador — el backend podria estar
 * rechazandolo y la pantalla mostrando ese rechazo, que es un comportamiento
 * distinto. Contar los posteos es lo que separa una cosa de la otra.
 *
 * Devuelve el array vivo, igual que `registrarNavegaciones` en
 * `movimientos.js`: se lee despues de ejercitar el flujo.
 */
export function contarPosteosDeMovimiento(page) {
  const posteos = [];

  page.on("request", (peticion) => {
    if (
      peticion.method() === "POST" &&
      new URL(peticion.url()).pathname === "/api/movimientos"
    ) {
      posteos.push(peticion.url());
    }
  });

  return posteos;
}
