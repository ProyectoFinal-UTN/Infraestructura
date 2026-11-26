import { expect } from "@playwright/test";

/**
 * Page object del dashboard de KPIs (HU-22).
 *
 * Como el panel de alertas de HU-17, no es una pantalla sino un widget de `/`
 * (`SeccionKpis` dentro de `pages/Inicio.jsx`). Solo se dibuja cuando la
 * configuracion ya resolvio y el rol tiene `kpi.read` (propietario y gerente).
 *
 * Cada numero tiene su testid `<kpi>-valor`, y es lo que se lee: el texto de la
 * tarjeta mezcla el numero con la etiqueta, y con separador de miles en es-AR
 * ("1.234"), asi que se compara contra el numero ya formateado.
 *
 * Los graficos (Recharts) se cargan en diferido y van `aria-hidden`. Cada uno
 * tiene al lado una tabla `sr-only` con los mismos datos, que es lo que lee un
 * lector de pantalla; los tests leen esa tabla para comparar datos, y el SVG
 * solo para ver que se dibujo.
 */
export class PanelDeKpis {
  constructor(page) {
    this.page = page;

    this.contenedor = page.getByTestId("kpis");
    this.cargando = page.getByTestId("kpis-cargando");
    this.error = page.getByTestId("kpis-error");
    this.actualizado = page.getByTestId("kpis-actualizado");
    this.sinMontos = page.getByTestId("kpis-sin-montos");

    this.selector = page.getByRole("group", { name: "Período de ventas y compras" });

    this.masVendidos = page.getByTestId("kpis-mas-vendido");

    this.stockVacio = page.getByTestId("kpis-stock-vacio");
    this.rotacionVacia = page.getByTestId("kpis-rotacion-vacio");
    this.comprasVacias = page.getByTestId("kpis-compras-vacio");
  }

  /** Entra al dashboard y espera a que los KPIs terminen de cargar. */
  async ir() {
    await this.page.goto("/");
    await this.esperarCarga();
  }

  /**
   * Espera contra `aria-busy="false"`, igual que el panel de alertas: el cartel
   * de carga solo existe en la primera, y el refresco de fondo no mueve
   * `aria-busy` a proposito. Timeout propio por lo mismo que alla: la primera
   * carga contra Neon despues de varias escrituras puede pasar los 10 s del
   * `expect` en una corrida con dos workers.
   */
  async esperarCarga() {
    await expect(this.contenedor).toHaveAttribute("aria-busy", "false", {
      timeout: 25_000,
    });
  }

  /** El numero de una tarjeta, por su testid (`kpi-ventas`, `kpi-sin-stock`…). */
  valor(testId) {
    return this.page.getByTestId(`${testId}-valor`);
  }

  ventana(dias) {
    return this.selector.getByRole("button", { name: `${dias} días` });
  }

  /** Cambia la ventana y espera la respuesta de ESA ventana, no cualquiera. */
  async elegirVentana(dias) {
    const respuesta = this.page.waitForResponse(
      (r) => r.url().includes("/api/kpis") && r.request().method() === "GET",
    );
    await this.ventana(dias).click();
    const recibida = await respuesta;
    await this.esperarCarga();
    return recibida;
  }

  /** La tabla accesible de un grafico, por su titulo. */
  tabla(titulo) {
    return this.page.getByRole("table", { name: titulo });
  }

  /** El contenedor del grafico de Recharts (`ventasPorDia`, ...). */
  grafico(tipo) {
    return this.page.getByTestId(`grafico-${tipo}`);
  }

  /** Las barras dibujadas de un grafico. Recharts les pone esta clase. */
  barras(tipo) {
    return this.grafico(tipo).locator(".recharts-bar-rectangle");
  }

  masVendido(productoId) {
    return this.page.locator(
      `[data-testid="kpis-mas-vendido"][data-kpi-producto-id="${productoId}"]`,
    );
  }
}
