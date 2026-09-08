import { expect } from "@playwright/test";

/**
 * Page object de `/registro` (HU-1).
 *
 * Mismas convenciones que `catalogo.js`: nada de `data-testid`, todo por rol y
 * etiqueta porque la pantalla es accesible. Incluye el link a "Productos" del
 * Inicio (y no un page object de Inicio aparte) porque es lo único de esa
 * pantalla que este flujo necesita: entrar a Productos por la navegación real,
 * no con `page.goto`.
 */
export class Registro {
  constructor(page) {
    this.page = page;

    this.encabezado = page.getByRole("heading", { name: "Creá tu cuenta" });
    this.campoCorreo = page.getByLabel("Correo");
    this.campoPassword = page.getByLabel("Contraseña", { exact: true });
    this.campoConfirmacion = page.getByLabel("Repetí la contraseña");
    this.botonCrearCuenta = page.getByRole("button", { name: "Crear cuenta" });
    this.errorGeneral = page.getByRole("alert");

    // De Inicio, la pantalla a la que redirige un registro exitoso.
    this.saludo = page.getByRole("heading", { name: /^Hola,/ });
    this.enlaceProductos = page.getByRole("link", { name: "Productos" });
  }

  async ir() {
    await this.page.goto("/registro");
    await expect(this.encabezado).toBeVisible();
  }

  async completar({ correo, password, confirmacion }) {
    if (correo !== undefined) await this.campoCorreo.fill(correo);
    if (password !== undefined) await this.campoPassword.fill(password);
    if (confirmacion !== undefined) {
      await this.campoConfirmacion.fill(confirmacion);
    }
  }

  enviar() {
    return this.botonCrearCuenta.click();
  }
}
