import { expect } from "@playwright/test";

/**
 * Lo minimo del historial de movimientos (`/movimientos`) que HU-32 necesita.
 *
 * No es el page object de HU-14: esa HU tiene filtros, paginacion y formatos
 * que se cubren con su propio E2E. Aca solo hace falta llegar a la lista y
 * poder mirar quien figura como autor de un movimiento.
 *
 * EL PUNTO FINO, y la razon de que este archivo exista: el correo del autor NO
 * es un campo propio de la pantalla, es el fallback del nombre.
 *
 *   {movimiento.usuario.nombre || movimiento.usuario.correo}
 *
 * Como el andamiaje siempre da de alta con nombre, por pantalla sale el nombre
 * para los tres roles y el correo nunca se renderiza. Entonces una asercion
 * como `expect(page.getByText(correo)).toHaveCount(0)` pasa SIEMPRE, incluso si
 * el backend empezara a mandar el correo a quien no debe: seria decorativa.
 *
 * Por eso el recorte se verifica sobre el payload que recibe el navegador de
 * cada rol (`esperarPayload`), y lo del DOM queda como lo que es: un chequeo
 * extra de que el correo no se filtro por algun otro lado de la pantalla.
 */
export class Historial {
  constructor(page) {
    this.page = page;

    this.titulo = page.getByRole("heading", {
      name: "Historial de movimientos",
      level: 1,
    });
  }

  /**
   * Entra al historial devolviendo el JSON que la pantalla recibio.
   *
   * Engancha la respuesta ANTES de navegar, en el mismo `Promise.all`: si se
   * esperara despues del `goto`, la respuesta ya podria haber pasado.
   *
   * Lo que devuelve es lo que vio ESTE navegador, con ESTA cookie. Eso es lo
   * que lo hace distinto del test de integracion del Backend, que arma el
   * pedido a mano: aca el rol sale de la sesion real y la respuesta cruza
   * Nginx.
   */
  async irYLeerPayload() {
    const [respuesta] = await Promise.all([
      this.page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === "/api/movimientos" &&
          r.request().method() === "GET",
      ),
      this.page.goto("/movimientos"),
    ]);

    expect(
      respuesta.status(),
      `El historial no cargo: ${await respuesta.text()}`,
    ).toBe(200);

    await this.esperarCarga();

    return respuesta.json();
  }

  /**
   * Espera a que la lista este, no solo el titulo.
   *
   * El `<h1>` es estatico —se renderiza antes de que la respuesta llegue—, asi
   * que por si solo no dice nada. Lo que marca el final de la carga es que
   * «Cargando movimientos…» se haya ido.
   */
  async esperarCarga() {
    await expect(this.titulo).toBeVisible();
    await expect(this.page.getByText("Cargando movimientos…")).toHaveCount(0);
  }
}
