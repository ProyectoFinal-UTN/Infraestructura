import { expect } from "@playwright/test";

/**
 * Page object del directorio de proveedores (`/proveedores`, HU-19).
 *
 * Mismo criterio que `catalogo.js`, porque la pantalla esta armada igual:
 *
 * - Todo por rol, etiqueta y texto. El unico `data-testid` que se usa es el
 *   cartel de solo lectura, que existe para preguntar «esta o no esta».
 * - Sin modal: el formulario es un `<form aria-label="...">` inline y la
 *   confirmacion de borrado reemplaza el `<li>` de la fila.
 * - «Editar», «Eliminar» y «Ver compras» llevan un `aria-label` que pisa el
 *   texto visible y nombra al proveedor.
 * - Literales a copiar tal cual: comillas `«»`, separador `·` (U+00B7) y la
 *   tilde de «Sí, eliminar».
 */
export class Proveedores {
  constructor(page) {
    this.page = page;

    this.titulo = page.getByRole("heading", { name: "Tus proveedores" });
    this.botonNuevo = page.getByRole("button", { name: "+ Nuevo proveedor" });
    this.listaVacia = page.getByText("Todavía no cargaste ningún proveedor.");
    this.mensajeExito = page.getByRole("status");
    this.soloLectura = page.getByTestId("proveedores-solo-lectura");
    this.formularioAlta = page.getByRole("form", { name: "Nuevo proveedor" });
    this.formularioEdicion = page.getByRole("form", { name: "Editar proveedor" });
  }

  /**
   * Entra a la pantalla y espera a que la lista este cargada: «Tus
   * proveedores» se renderiza recien cuando `GET /api/proveedores` respondio.
   */
  async ir() {
    await this.page.goto("/proveedores");
    await expect(this.titulo).toBeVisible();
  }

  async abrirAlta() {
    await this.botonNuevo.click();
    await expect(this.formularioAlta).toBeVisible();
  }

  /** Las etiquetas de los opcionales llevan «(opcional)»; el nombre, no. */
  async completar(formulario, campos) {
    const etiquetas = {
      nombre: "Nombre",
      contacto: "Persona de contacto (opcional)",
      telefono: "Teléfono (opcional)",
      correo: "Correo (opcional)",
      rubro: "Rubro (opcional)",
      condicionesPago: "Condiciones de pago (opcional)",
    };

    for (const [campo, valor] of Object.entries(campos)) {
      await formulario.getByLabel(etiquetas[campo], { exact: true }).fill(valor);
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
   * La fila del proveedor. Por el link «Ver compras», que nombra al proveedor
   * entero: filtrar por texto suelto confundiria «Distribuidora Sur» con
   * «Distribuidora Sur 2».
   */
  fila(nombre) {
    return this.page.getByRole("listitem").filter({
      has: this.page.getByRole("link", { name: `Ver compras a ${nombre}`, exact: true }),
    });
  }

  botonEditar(nombre) {
    return this.page.getByRole("button", { name: `Editar ${nombre}`, exact: true });
  }

  botonEliminar(nombre) {
    return this.page.getByRole("button", { name: `Eliminar ${nombre}`, exact: true });
  }

  /** El `<li>` de confirmacion que reemplaza a la fila al pedir la baja. */
  confirmacion(nombre) {
    return this.page
      .getByRole("listitem")
      .filter({ hasText: `¿Eliminar «${nombre}»?` });
  }
}
