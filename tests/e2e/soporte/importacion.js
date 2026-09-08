import { expect } from "@playwright/test";

/**
 * Page object de la pantalla de importacion de catalogo (`/productos/importar`,
 * HU-7).
 *
 * Mismo criterio que `catalogo.js`: no hay `data-testid` en el codigo de
 * produccion del Frontend, asi que todo se ubica por rol, etiqueta y texto. La
 * pantalla es accesible, alcanza con eso.
 *
 * Las trampas que resuelve de una sola vez:
 *
 * - El `role="status"` aparece dos veces en la pantalla, pero nunca a la vez:
 *   el «Esto puede tardar un momento…» mientras sube, y el resumen despues. Son
 *   ramas distintas del mismo ternario (`reporte ? ... : ...`), asi que en
 *   cuanto llega el reporte el primero deja de existir.
 * - El `role="alert"` tambien es dos cosas: el aviso ambar de la columna que
 *   falta (lo decide el cliente al leer el archivo) y el mensaje del 400 (lo
 *   decide el backend). Se distinguen por el texto, no por el selector.
 * - El boton de confirmar lleva la cuenta adentro del nombre («Confirmar carga
 *   de 5 productos»), asi que se busca por prefijo.
 * - `<input type="file">` se completa con `setInputFiles`, que dispara el
 *   `change` real: la pantalla limpia el `value` en cuanto captura el `File`,
 *   asi que elegir dos veces el mismo archivo sigue funcionando.
 */
export class Importacion {
  constructor(page) {
    this.page = page;

    this.titulo = page.getByRole("heading", { name: "Importar catálogo" });
    this.inputArchivo = page.getByLabel("Archivo CSV");
    this.aviso = page.getByRole("alert");
    this.resumen = page.getByRole("status");
    this.vistaPrevia = page.getByRole("heading", { name: "Vista previa" });
    this.botonConfirmar = page.getByRole("button", {
      name: /^Confirmar carga de /,
    });
    this.listaDeErrores = page.getByRole("list", {
      name: "Filas que no se cargaron",
    });
    this.linkAlCatalogo = page.getByRole("link", { name: "Ver el catálogo" });
  }

  /** Entra directo por URL, para los tests que no vienen a probar la navegacion. */
  async ir() {
    await this.page.goto("/productos/importar");
    await expect(this.titulo).toBeVisible();
  }

  /**
   * Entra por donde entra un usuario: desde el catalogo, por el link real.
   *
   * El link solo se muestra si el rol no es `empleado`, asi que esto tambien
   * confirma que la pantalla es alcanzable para quien puede importar.
   */
  async irDesdeElCatalogo() {
    await this.page.goto("/productos");
    await this.page.getByRole("link", { name: "Importar desde CSV" }).click();
    await expect(this.titulo).toBeVisible();
  }

  /** Elige el archivo y espera a que la pantalla termine de leerlo. */
  async elegir(fixture) {
    await this.inputArchivo.setInputFiles(fixture.ruta);
  }

  /**
   * Confirma la carga y devuelve el reporte que contesto el backend.
   *
   * Se espera la respuesta y no un texto de la pantalla porque es lo unico que
   * sincroniza de verdad —una importacion de 1000 filas son 1000
   * transacciones— y ademas es lo que permite verificar el contrato (el
   * invariante, los numeros de fila) contra lo que el usuario esta viendo.
   */
  async confirmar() {
    const [respuesta] = await Promise.all([
      this.page.waitForResponse(
        (r) =>
          r.url().includes("/api/productos/importar") &&
          r.request().method() === "POST",
      ),
      this.botonConfirmar.click(),
    ]);

    expect(
      respuesta.status(),
      `La importación no devolvió 200: ${await respuesta.text()}`,
    ).toBe(200);

    return respuesta.json();
  }

  /** La fila de la lista de rechazos, ubicada por su numero de fila del archivo. */
  filaConError({ fila, codigoBarras }) {
    return this.listaDeErrores
      .getByRole("listitem")
      .filter({ hasText: `Fila ${fila} · ${codigoBarras}` });
  }

  /**
   * Abre el `<details>` con lo que si entro y devuelve sus items.
   *
   * Viene colapsado a proposito —el foco tiene que quedar en lo que falta—, asi
   * que hay que abrirlo antes de poder leer nada adentro. Los `<li>` se buscan
   * dentro del `<details>` para no confundirlos con los de la lista de
   * rechazos, que estan en la misma pantalla.
   */
  async verImportados(cantidad) {
    await this.page
      .getByText(
        cantidad === 1
          ? "Ver el producto importado"
          : `Ver los ${cantidad} productos importados`,
        { exact: true },
      )
      .click();

    return this.page.locator("details").getByRole("listitem");
  }
}
