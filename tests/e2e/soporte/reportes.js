import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import { leerPdf } from "../../soporte/reportes.js";

/**
 * Page object de la tarjeta «Generar reporte PDF» (HU-25) y de la pantalla
 * provisoria `/reportes` que la monta.
 *
 * Mezcla las dos convenciones del repo, y a proposito: los campos van por rol y
 * etiqueta (son accesibles: radios de verdad, `<label>` en las fechas y en los
 * selectores), y los estados que la pantalla pinta —la tarjeta, el aviso de
 * descarga, el cartel de sin permiso— van por el `data-testid` que el Frontend
 * agrego para esto, igual que en `accesos.js`.
 *
 * Todo lo de la tarjeta queda acotado a ella: «Desde» y «Hasta» son etiquetas
 * que tambien usa el historial, y el dia que la pagina de HU-22/23 sume un
 * filtro de fechas propio, un `getByLabel("Desde")` suelto encontraria dos.
 */
export class Reportes {
  /** El mensaje del rango invertido, con las comillas angulares del Frontend. */
  static RANGO_INVERTIDO = "La fecha «Desde» no puede ser posterior a «Hasta».";

  constructor(page) {
    this.page = page;

    // Navegacion. En celular el link vive dentro del panel «Más».
    this.acceso = page.getByTestId("acceso-reportes");
    this.botonMas = page.getByRole("button", { name: "Más" });

    this.titulo = page.getByRole("heading", { name: "Reportes y KPIs", level: 1 });
    this.sinPermiso = page.getByTestId("sin-permiso");

    this.tarjeta = page.getByTestId("tarjeta-reporte-pdf");
    const tarjeta = this.tarjeta;

    this.encabezado = tarjeta.getByRole("heading", { name: "Generar reporte PDF" });
    this.desde = tarjeta.getByLabel("Desde");
    this.hasta = tarjeta.getByLabel("Hasta");
    this.errorDesde = tarjeta.locator("#error-reporte-desde");
    this.producto = tarjeta.getByRole("combobox", { name: "Producto" });
    this.proveedor = tarjeta.getByRole("combobox", { name: "Proveedor" });
    this.generar = tarjeta.getByRole("button", { name: "Generar y descargar" });
    this.descargado = tarjeta.getByTestId("reporte-descargado");
    this.alerta = tarjeta.getByRole("alert");
  }

  /** El radio de un tipo, por su etiqueta visible ("Por período", ...). */
  tipo(etiqueta) {
    return this.tarjeta.getByRole("radio", { name: etiqueta });
  }

  /** Entra por URL y espera la tarjeta, que solo aparece con los permisos ya resueltos. */
  async ir() {
    await this.page.goto("/reportes");
    await expect(this.titulo).toBeVisible();
    await expect(this.tarjeta).toBeVisible();
  }

  /** Los dias que tiene cargados el formulario, como los entrega el `<input type="date">`. */
  async rango() {
    return {
      desde: await this.desde.inputValue(),
      hasta: await this.hasta.inputValue(),
    };
  }

  /**
   * Elige el producto o el proveedor por su id. Espera a que el selector se
   * habilite: mientras carga el catalogo esta deshabilitado con una sola
   * opcion («Cargando productos…»), y un `selectOption` ahi fallaria por otra
   * razon que la que se quiere ver.
   */
  async elegir(selector, id) {
    await expect(selector).toBeEnabled();
    await selector.selectOption(id);
  }

  /**
   * Aprieta «Generar y descargar» y devuelve la descarga.
   *
   * El evento se espera ANTES del clic, con `Promise.all`: si el PDF llega muy
   * rapido, un `waitForEvent` puesto despues se lo pierde.
   */
  async generarYDescargar() {
    const [descarga] = await Promise.all([
      this.page.waitForEvent("download"),
      this.generar.click(),
    ]);

    return descarga;
  }

  /**
   * Lee el PDF que bajo el navegador. Es el archivo real: el Blob que armo la
   * tarjeta con lo que respondio el backend a traves de Nginx.
   */
  static async leerDescarga(descarga) {
    const contenido = await readFile(await descarga.path());

    expect(
      contenido.subarray(0, 5).toString("latin1"),
      "el archivo descargado no empieza como un PDF",
    ).toBe("%PDF-");

    return leerPdf(contenido);
  }
}
