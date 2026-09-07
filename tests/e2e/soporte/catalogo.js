import { expect } from "@playwright/test";

/**
 * Page object del catalogo de productos (`/productos`, HU-9).
 *
 * Concentra los selectores porque la pantalla tiene varias trampas que
 * conviene resolver una sola vez:
 *
 * - No hay `data-testid` en el codigo de produccion del Frontend, asi que todo
 *   se ubica por rol, etiqueta y texto. Alcanza: la pantalla es accesible.
 * - No hay modal. El formulario es un `<form aria-label="...">` inline y la
 *   confirmacion de borrado reemplaza el `<li>` de la fila.
 * - Los botones «Editar» y «Eliminar» llevan un `aria-label` que pisa el texto
 *   visible: su nombre accesible es `Editar <nombre del producto>`.
 * - «Cancelar» existe en el formulario y en la confirmacion, asi que siempre
 *   se busca dentro de uno de los dos.
 * - Varios textos tienen caracteres que hay que copiar literales: la elipsis
 *   `…` (U+2026), las comillas `«»`, el separador `·` (U+00B7) y la tilde de
 *   «Sí, eliminar».
 */
export class Catalogo {
  constructor(page) {
    this.page = page;

    this.titulo = page.getByRole("heading", { name: "Catálogo" });
    this.botonCargarAMano = page.getByRole("button", { name: "+ Cargar a mano" });
    this.listaVacia = page.getByText("Todavía no cargaste ningún producto.");
    this.mensajeExito = page.getByRole("status");
    this.formularioAlta = page.getByRole("form", { name: "Nuevo producto" });
    this.formularioEdicion = page.getByRole("form", { name: "Editar producto" });
  }

  /**
   * Entra a la pantalla y espera a que el catalogo este cargado.
   *
   * El «Catálogo» solo se renderiza cuando `GET /api/productos` respondio, asi
   * que esperarlo cubre de una los dos estados intermedios: el «Cargando…» de
   * la ruta protegida mientras resuelve la sesion y el «Cargando productos…»
   * de la pantalla.
   */
  async ir() {
    await this.page.goto("/productos");
    await expect(this.titulo).toBeVisible();
  }

  async abrirAlta() {
    await this.botonCargarAMano.click();
    await expect(this.formularioAlta).toBeVisible();
  }

  /**
   * Completa el formulario. `Stock inicial` solo existe en el alta: el PUT del
   * backend no acepta stock porque cambiar cantidades es HU-13.
   */
  async completar(formulario, campos) {
    if (campos.codigoBarras !== undefined) {
      await formulario.getByLabel("Código de barras").fill(campos.codigoBarras);
    }
    if (campos.nombre !== undefined) {
      await formulario.getByLabel("Nombre", { exact: true }).fill(campos.nombre);
    }
    if (campos.categoria !== undefined) {
      await formulario.getByLabel("Categoría").fill(campos.categoria);
    }
    if (campos.unidadMedida !== undefined) {
      await formulario
        .getByLabel("Unidad de medida")
        .selectOption(campos.unidadMedida);
    }
    if (campos.umbralMinimo !== undefined) {
      await formulario.getByLabel("Umbral mínimo").fill(campos.umbralMinimo);
    }
    if (campos.stockActual !== undefined) {
      await formulario.getByLabel("Stock inicial").fill(campos.stockActual);
    }
  }

  guardar(formulario) {
    return formulario.getByRole("button", { name: "Guardar" }).click();
  }

  /** Error anclado a un campo (el `<p id="error-<campo>">` de `Campo.jsx`). */
  errorDeCampo(campo) {
    return this.page.locator(`#error-${campo}`);
  }

  /**
   * La fila del producto en el listado.
   *
   * Se ubica por codigo de barras y no por nombre porque el codigo no cambia
   * al editar: la misma fila sirve antes y despues.
   */
  fila(producto) {
    return this.page
      .getByRole("listitem")
      .filter({ hasText: producto.codigoBarras });
  }

  botonEditar(producto) {
    return this.page.getByRole("button", { name: `Editar ${producto.nombre}` });
  }

  botonEliminar(producto) {
    return this.page.getByRole("button", { name: `Eliminar ${producto.nombre}` });
  }

  /** El `<li>` de confirmacion que reemplaza a la fila al pedir la baja. */
  confirmacion(producto) {
    return this.page
      .getByRole("listitem")
      .filter({ hasText: `¿Eliminar «${producto.nombre}»?` });
  }
}
