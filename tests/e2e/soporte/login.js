import { expect } from "@playwright/test";

/**
 * Page object de `/login` (HU-2).
 *
 * Mismas convenciones que `registro.js`: todo por rol y etiqueta, nada de
 * `data-testid`, porque la pantalla es accesible.
 *
 * Incluye lo que hace falta de Inicio —el saludo y el boton de salir— y no un
 * page object aparte, por la misma razon que `registro.js` incluye el link a
 * Productos: es lo unico de esa pantalla que este flujo necesita.
 */
export class Login {
  constructor(page) {
    this.page = page;

    this.encabezado = page.getByRole("heading", { name: "Iniciar sesión" });
    this.campoCorreo = page.getByLabel("Correo");
    this.campoPassword = page.getByLabel("Contraseña", { exact: true });
    this.botonEntrar = page.getByRole("button", { name: "Entrar" });
    this.error = page.getByRole("alert");
    this.enlaceOlvido = page.getByRole("link", {
      name: "¿Olvidaste tu contraseña?",
    });

    // De Inicio, la pantalla a la que se llega con sesion.
    this.saludo = page.getByRole("heading", { name: /^Hola,/ });
    this.botonSalir = page.getByRole("button", { name: "Cerrar sesión" });
    this.enlaceConfiguracion = page.getByRole("link", { name: "Configuración" });
  }

  async ir() {
    await this.page.goto("/login");
    await expect(this.encabezado).toBeVisible();
  }

  async entrar({ correo, password }) {
    await this.campoCorreo.fill(correo);
    await this.campoPassword.fill(password);
    await this.botonEntrar.click();
  }
}
