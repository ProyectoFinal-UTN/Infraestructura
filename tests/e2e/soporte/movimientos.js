import { expect } from "@playwright/test";

/**
 * Page object del registro de movimientos (`/movimientos/nuevo`, HU-13).
 *
 * Mismo criterio que `catalogo.js`: el Frontend no tiene `data-testid`, asi que
 * todo se ubica por rol y etiqueta. Las trampas propias de esta pantalla:
 *
 * - «Registrar movimiento» aparece tres veces: el `<h1>`, el `aria-label` del
 *   `<form>` y el boton de submit. Se distinguen por rol, y el boton se busca
 *   siempre dentro del formulario — en la pantalla de inicio hay ademas un link
 *   con ese mismo texto.
 * - El selector de ubicacion **no existe** cuando el comercio tiene una sola
 *   (`pideUbicacion = ubicaciones.length > 1`). No esta oculto: no se renderiza.
 * - El sentido (entrada/salida) son radios y solo aparecen con el tipo `ajuste`.
 * - La confirmacion es `role="status"`; el rechazo por stock y el error general
 *   comparten `role="alert"`, pero nunca conviven: `alEnviar` limpia el error
 *   antes de postear y en el 409 corta con un return.
 */

/** La ubicacion que el alta del primer producto crea sola (HU-9). */
export const UBICACION_POR_DEFECTO = "Principal";

const ETIQUETA_SENTIDO = {
  entrada: "Entrada (suma al stock)",
  salida: "Salida (resta del stock)",
};

export class Movimientos {
  constructor(page) {
    this.page = page;

    this.titulo = page.getByRole("heading", { name: "Registrar movimiento" });
    this.formulario = page.getByRole("form", { name: "Registrar movimiento" });

    this.producto = this.formulario.getByLabel("Producto", { exact: true });
    this.tipo = this.formulario.getByLabel("Tipo de movimiento");
    this.cantidad = this.formulario.getByLabel("Cantidad", { exact: true });
    this.ubicacion = this.formulario.getByLabel("Ubicación", { exact: true });

    this.botonRegistrar = this.formulario.getByRole("button", {
      name: "Registrar movimiento",
    });

    this.confirmacion = this.formulario.getByRole("status");
    this.alerta = this.formulario.getByRole("alert");
  }

  /**
   * Entra a la pantalla y espera a que el formulario este dibujado.
   *
   * Esperar el formulario y no el titulo cubre de una los tres estados
   * intermedios: el «Cargando…» de la ruta protegida mientras resuelve la
   * sesion, el «Cargando datos…» de la pantalla, y los dos GET (productos y
   * ubicaciones) que tienen que volver antes de que haya algo que completar.
   */
  async ir() {
    await this.page.goto("/movimientos/nuevo");
    await expect(this.formulario).toBeVisible();
  }

  /** El radio de sentido, que solo existe cuando el tipo es «ajuste». */
  sentido(valor) {
    return this.formulario.getByRole("radio", { name: ETIQUETA_SENTIDO[valor] });
  }

  /**
   * Completa el formulario.
   *
   * El producto y la ubicacion se eligen por el texto visible de la `<option>`
   * (el nombre), porque el `value` es un UUID que el test no tiene por que
   * conocer. El tipo, en cambio, va por `value` (`compra`, `venta`, …): es el
   * mismo string que viaja al backend, asi que si alguien cambia la etiqueta
   * comercial el test no se entera, que es lo correcto.
   */
  async completar({ producto, tipo, sentido, cantidad, ubicacion }) {
    if (producto !== undefined) {
      await this.producto.selectOption({ label: producto });
    }
    if (tipo !== undefined) {
      await this.tipo.selectOption(tipo);
    }
    if (sentido !== undefined) {
      await this.sentido(sentido).check();
    }
    if (cantidad !== undefined) {
      await this.cantidad.fill(String(cantidad));
    }
    if (ubicacion !== undefined) {
      await this.ubicacion.selectOption({ label: ubicacion });
    }
  }

  registrar() {
    return this.botonRegistrar.click();
  }

  /** Error anclado a un campo (el `<p id="error-<campo>">` de `Campo`/`CampoSelect`). */
  errorDeCampo(campo) {
    return this.page.locator(`#error-${campo}`);
  }
}

/**
 * El texto exacto de la confirmacion, tal como lo arma `mensajeConfirmacion`.
 *
 * Se replica aca en vez de afirmar con un `toContainText(String(saldo))` porque
 * un numero suelto matchea de mas: con un saldo de 2 unidades, un «2» aparece
 * tambien en el nombre del producto o en la cantidad movida. La frase completa
 * ata la asercion al saldo y a la ubicacion, que es lo que el criterio pide.
 *
 * El singular no es un detalle de estilo: es una rama distinta de la funcion.
 */
export function confirmacionEsperada({ producto, saldo, ubicacion }) {
  const unidades = `${saldo} ${saldo === 1 ? "unidad" : "unidades"}`;

  return ubicacion
    ? `Listo. ${producto} quedó con ${unidades} en ${ubicacion}.`
    : `Listo. ${producto} quedó con ${unidades}.`;
}

/**
 * Acumula las pantallas por las que pasa el frame principal desde que se llama.
 *
 * Lo usa el test del RNF1: contar los pasos a mano no prueba nada si nadie
 * verifica que entre el inicio y la confirmacion no hubo pantallas intermedias.
 * Devuelve el array vivo — se lee despues de completar el flujo.
 *
 * `framenavigated` tambien se dispara con las navegaciones del History API, que
 * es como se mueve React Router, asi que el `<Link>` del inicio queda contado
 * igual que una carga completa.
 *
 * Dos filtros para que la lista signifique "pantallas" y no "eventos": se
 * ignora todo lo que no sea http (el `about:blank` inicial del contexto) y se
 * colapsan los repetidos consecutivos, porque un mismo destino puede emitir mas
 * de un evento sin que el usuario haya ido a ningun lado.
 */
export function registrarNavegaciones(page) {
  const visitadas = [];

  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    if (!frame.url().startsWith("http")) return;

    const ruta = new URL(frame.url()).pathname;

    if (visitadas.at(-1) !== ruta) {
      visitadas.push(ruta);
    }
  });

  return visitadas;
}
