import { expect } from "@playwright/test";

/**
 * Page object del Asistente Inteligente (HU-26).
 *
 * No es una pantalla: es un botón flotante con un panel, montado una sola vez
 * en la app y presente en todas las pantallas con sesión. Por eso no tiene
 * `ir()`: se entra a cualquier pantalla y se lo abre desde ahí.
 *
 * Mismas convenciones que `login.js`: todo por rol y etiqueta, nada de
 * `data-testid`. El panel es una `section` con nombre accesible, así que se lo
 * encuentra como `region`.
 */
export class Asistente {
  constructor(page) {
    this.page = page;

    // `exact`: si no, "Asistente" también matchea "Cerrar el asistente".
    this.boton = page.getByRole("button", { name: "Asistente", exact: true });
    this.panel = page.getByRole("region", { name: "Asistente" });
    this.campo = page.getByLabel("Tu pregunta");
    this.botonPreguntar = page.getByRole("button", { name: "Preguntar" });
    this.botonCerrar = page.getByRole("button", { name: "Cerrar el asistente" });
    this.conversacion = page.getByRole("list", {
      name: "Conversación con el asistente",
    });
    this.turnos = this.conversacion.getByRole("listitem");
  }

  async abrir() {
    await this.boton.click();
    await expect(this.campo).toBeVisible();
  }

  /**
   * Pregunta y espera a que llegue la respuesta.
   *
   * La espera es por el turno que termina de buscar, no por un texto de
   * respuesta: el texto del modo limitado lo escribe HU-28 y va a cambiar.
   */
  async preguntar(texto) {
    await this.campo.fill(texto);
    await this.botonPreguntar.click();

    const turno = this.turnos.filter({ hasText: texto }).last();
    await expect(turno).toBeVisible();
    await expect(turno.getByText("Buscando en tus datos…")).toHaveCount(0);

    return turno;
  }
}
