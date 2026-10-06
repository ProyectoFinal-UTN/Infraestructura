import { expect } from "@playwright/test";

/**
 * Page object de la transferencia entre ubicaciones (`/transferencias`, HU-12).
 *
 * Primera pantalla del proyecto con `data-testid`, asi que los paneles se ubican
 * por ahi y no por texto; los campos siguen yendo por rol y etiqueta, como en
 * `movimientos.js` y `detalleProducto.js`. Las trampas propias de esta pantalla:
 *
 * - «Transferir stock» aparece dos veces: el `<h1>` y el `aria-label` del
 *   `<form>`. Se distinguen por rol. Y «Transferir» a secas es el boton de
 *   submit, que mientras envia pasa a «Transfiriendo…» — de ahi el `exact` al
 *   buscarlo, porque sin el matchea las dos formas y la asercion se vuelve muda.
 * - Las `<option>` de origen y destino llevan el saldo pegado al nombre
 *   («Principal (10 unidades)»), y la etiqueta *cambia* cuando vuelve la consulta
 *   de stock: antes de eso sale el nombre pelado. Se elige siempre por `value`
 *   (el id de la ubicacion), nunca por texto.
 * - El destino no ofrece el origen, y elegir como origen la ubicacion que estaba
 *   como destino vacia el destino. Por eso `elegir()` fija en un orden fijo y
 *   deja el destino para el final.
 * - Mientras el panel dice «Consultando stock…» el boton esta deshabilitado.
 *   Enviar antes de que el disponible este a la vista hace caer el test por
 *   timeout del click, sin decir por que: `esperarDisponible()` es el candado
 *   contra eso y hay que llamarlo antes de todo envio.
 * - El bloqueo local por stock NO usa `transferencia-aviso-stock` —ese panel es
 *   solo del 409 del backend—: sale como error del campo Cantidad
 *   (`#error-cantidad`). Son dos caminos distintos y los tests los separan.
 */

/** La ubicacion que el alta del primer producto crea sola (HU-9). */
export const UBICACION_POR_DEFECTO = "Principal";

export class Transferencias {
  constructor(page) {
    this.page = page;

    this.titulo = page.getByRole("heading", { name: "Transferir stock" });
    this.formulario = page.getByRole("form", { name: "Transferir stock" });

    this.producto = this.formulario.getByLabel("Producto", { exact: true });
    this.origen = this.formulario.getByLabel("Origen", { exact: true });
    this.destino = this.formulario.getByLabel("Destino", { exact: true });
    this.cantidad = this.formulario.getByLabel("Cantidad", { exact: true });
    this.motivo = this.formulario.getByLabel("Motivo (opcional)", {
      exact: true,
    });

    this.botonTransferir = this.formulario.getByRole("button", {
      name: "Transferir",
      exact: true,
    });

    // Los paneles se buscan en la pagina y no en el formulario: la confirmacion y
    // el aviso viven adentro, pero el estado vacio de «menos de dos ubicaciones»
    // se dibuja en lugar del formulario, asi que acotarlo lo volveria inhallable.
    this.disponible = page.getByTestId("transferencia-disponible");
    this.avisoStock = page.getByTestId("transferencia-aviso-stock");
    this.error = page.getByTestId("transferencia-error");
    this.sinUbicaciones = page.getByTestId("transferencia-sin-ubicaciones");
    this.confirmacion = page.getByTestId("transferencia-confirmacion");
  }

  /**
   * Entra a la pantalla y espera a que el formulario este dibujado.
   *
   * Esperar el formulario cubre de una los estados intermedios: el «Cargando…»
   * de la ruta protegida mientras resuelve la sesion, el «Cargando datos…» de la
   * pantalla, y los dos GET (productos y ubicaciones) que tienen que volver antes
   * de que haya algo que completar.
   *
   * Con `productoId` entra por la URL que arma el link del detalle de producto.
   * Ese parametro se lee una sola vez, como valor inicial del `<select>`.
   */
  async ir({ productoId } = {}) {
    await this.page.goto(
      productoId ? `/transferencias?productoId=${productoId}` : "/transferencias",
    );
    await expect(this.formulario).toBeVisible();
  }

  /**
   * Entra sin esperar el formulario, para los casos en que no tiene que haberlo.
   *
   * Se ancla al `<h1>`, que se dibuja siempre: el estado vacio de menos de dos
   * ubicaciones reemplaza al formulario, asi que `ir()` se quedaria esperando algo
   * que nunca aparece y el test caeria por timeout en vez de por su asercion.
   */
  async irSinFormulario() {
    await this.page.goto("/transferencias");
    await expect(this.titulo).toBeVisible();
  }

  /**
   * Espera a que el panel muestre el saldo del origen y el boton quede usable.
   *
   * Es el candado contra la falla mas molesta de esta pantalla. El boton esta
   * deshabilitado mientras el saldo del origen no se conozca (`stockDesconocido`)
   * o sea cero (`sinStock`), asi que un `click()` disparado antes se queda
   * esperando a que el elemento sea accionable y el test muere por timeout sin
   * decir cual era el problema real.
   *
   * Se afirman las dos cosas —el texto y el `toBeEnabled()`— porque son dos
   * condiciones distintas: el panel puede estar mostrando un saldo viejo mientras
   * una re-consulta en curso mantiene el boton apagado.
   */
  async esperarDisponible(nombreOrigen) {
    await expect(this.disponible).toContainText(
      `Disponible en ${nombreOrigen}:`,
    );
    await expect(this.botonTransferir).toBeEnabled();
  }

  /**
   * Completa el formulario.
   *
   * El producto y las ubicaciones se eligen por `value` —el id— y no por la
   * etiqueta visible, al revés que en `movimientos.js`. No es una inconsistencia:
   * aca la etiqueta lleva el saldo pegado y muta cuando vuelve la consulta de
   * stock, asi que el texto no es un ancla estable. El id lo da
   * `leerUbicaciones` / `crearProductoViaApi`.
   *
   * El orden no es decorativo: el `<select>` de destino excluye lo que este
   * elegido como origen, y cambiar el origen a la ubicacion que estaba de destino
   * limpia el destino. Fijando siempre producto → origen → destino, el destino se
   * escribe ultimo y nada lo pisa.
   *
   * Los campos son opcionales para poder mandar el formulario incompleto a
   * proposito y ver la validacion.
   */
  async elegir({ producto, origen, destino, cantidad, motivo } = {}) {
    if (producto !== undefined) {
      await this.producto.selectOption(producto);
    }
    if (origen !== undefined) {
      await this.origen.selectOption(origen);
    }
    if (destino !== undefined) {
      await this.destino.selectOption(destino);
    }
    if (cantidad !== undefined) {
      await this.cantidad.fill(String(cantidad));
    }
    if (motivo !== undefined) {
      await this.motivo.fill(motivo);
    }
  }

  transferir() {
    return this.botonTransferir.click();
  }

  /**
   * Dispara dos submits en el mismo tick, para probar el candado del doble envio.
   *
   * Un `dblclick()` no sirve: el primer click deshabilita el boton, asi que el
   * segundo no llega nunca y el test pasaria en verde sin haber ejercitado nada.
   * Lo que frena el segundo envio de verdad es una `ref` que el handler lee en su
   * primera linea, antes de validar; y una `ref` solo se puede poner a prueba
   * entrando dos veces al handler *antes* de que React vuelva a renderizar. Dos
   * `requestSubmit()` sincronicos son exactamente eso.
   *
   * El formulario es `noValidate`, asi que `requestSubmit()` no se frena en la
   * validacion nativa del navegador.
   */
  dobleEnvio() {
    return this.page.evaluate(() => {
      const f = document.querySelector('form[aria-label="Transferir stock"]');
      f.requestSubmit();
      f.requestSubmit();
    });
  }

  /** Error anclado a un campo (el `<p id="error-<campo>">` de `Campo`/`CampoSelect`). */
  errorDeCampo(campo) {
    return this.page.locator(`#error-${campo}`);
  }

  /** El link «Ir a Configuración →» del estado vacio. */
  get irAConfiguracion() {
    return this.page.getByRole("link", { name: "Ir a Configuración →" });
  }

  /** El texto de ayuda de las unidades continuas (kg, l). */
  get ayudaEnteros() {
    return this.formulario.getByText("Las transferencias se cargan en números");
  }
}

/** El link de la pantalla de inicio, que es el camino real a la pantalla. */
export function linkDesdeInicio(page) {
  return page.getByRole("link", { name: "Transferir stock" });
}

/**
 * El link del detalle de producto, que ademas lleva el producto elegido.
 *
 * Solo existe cuando el producto tiene dos o mas filas de stock, que con el
 * `LEFT JOIN` de HU-11 equivale a que el comercio tenga dos o mas ubicaciones.
 */
export function linkDesdeDetalle(page) {
  return page.getByRole("link", { name: "Transferir entre ubicaciones →" });
}

/**
 * El texto exacto de la confirmacion, tal como lo arma `mensajeConfirmacion`.
 *
 * Se replica aca en vez de afirmar con un `toContainText(String(saldo))` por lo
 * mismo que en `movimientos.js`: un numero suelto matchea de mas —con un saldo de
 * 3 unidades, un «3» aparece tambien en la cantidad movida y en el nombre del
 * producto— y la frase completa ata la asercion a los dos saldos y a las dos
 * ubicaciones, que es lo que el criterio de la HU pide.
 *
 * Solo la unidad `unidad` se pluraliza: «3 kg» y «2 caja» van tal cual. Esa es la
 * regla de `formatearCantidad`, y el singular no es un detalle de estilo sino una
 * rama distinta de la funcion.
 */
export function confirmacionEsperada({
  producto,
  cantidad,
  origen,
  destino,
  saldoOrigen,
  saldoDestino,
  unidad = "unidad",
}) {
  const formatear = (valor) =>
    unidad === "unidad"
      ? `${valor} ${valor === 1 ? "unidad" : "unidades"}`
      : `${valor} ${unidad}`;

  return (
    `Listo. Transferiste ${formatear(cantidad)} de ${producto} ` +
    `de ${origen} a ${destino}. ` +
    `Ahora hay ${formatear(saldoOrigen)} en ${origen} ` +
    `y ${formatear(saldoDestino)} en ${destino}.`
  );
}
