import { expect } from "@playwright/test";

/**
 * Page object del historial de movimientos (`/movimientos`).
 *
 * Nacio con HU-32, que solo necesitaba llegar a la lista y mirar quien figura
 * como autor de un movimiento, y se completo con HU-14: filtros, paginacion y
 * lo que muestra cada movimiento. Es uno solo para las dos suites, como el
 * resto de los page objects: uno por pantalla.
 *
 * Mismas convenciones que `login.js`: todo por rol y etiqueta, nada de
 * `data-testid`. Y todo acotado al `<main>` de la pantalla: la lista de
 * movimientos es un `<ul>` sin nombre, y contar `listitem` en toda la pagina
 * se romperia en cuanto aparezca otra lista afuera —la del asistente, o la de
 * una navegacion lateral—.
 *
 * EL PUNTO FINO de HU-32, y la razon de que este archivo existiera: el correo
 * del autor NO es un campo propio de la pantalla, es el fallback del nombre.
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

    const principal = page.getByRole("main");

    // Filtros (HU-14). Las fechas son `<input type="date">`: se completan con
    // `fill("AAAA-MM-DD")`, que es el valor que el input entiende.
    this.desde = principal.getByLabel("Desde");
    this.hasta = principal.getByLabel("Hasta");
    this.producto = principal.getByLabel("Producto");
    this.tipo = principal.getByLabel("Tipo");
    // Solo existe con mas de una ubicacion (HU-8): con una sola no hay nada que
    // filtrar.
    this.ubicacion = principal.getByLabel("Ubicación");
    this.limpiarFiltros = principal.getByRole("button", {
      name: "Limpiar filtros",
    });
    this.errorDeRango = principal.getByText(
      "La fecha «Desde» no puede ser posterior a «Hasta».",
    );

    // Resultado.
    this.movimientos = principal.getByRole("listitem");
    this.contador = principal.getByText(/^\d+ movimientos?$/);
    this.sinResultados = principal.getByText(
      "No hay movimientos que coincidan con esos filtros.",
    );
    this.sinMovimientos = principal.getByText(
      "Todavía no hay movimientos registrados.",
    );

    // Paginacion: solo aparece con mas de una pagina.
    this.paginacion = principal.getByRole("navigation", { name: "Paginación" });
    this.anterior = this.paginacion.getByRole("button", { name: /Anterior/ });
    this.siguiente = this.paginacion.getByRole("button", { name: /Siguiente/ });
  }

  /** Entra al historial, opcionalmente con filtros en la URL, y espera la lista. */
  async ir(query = "") {
    await this.page.goto(`/movimientos${query}`);
    await this.esperarCarga();
  }

  /** Los movimientos de un producto, por su nombre. */
  movimientosDe(nombreProducto) {
    return this.movimientos.filter({ hasText: nombreProducto });
  }

  /** "Página 1 de 2". */
  textoDePagina(pagina, total) {
    return this.paginacion.getByText(`Página ${pagina} de ${total}`);
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
