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

/**
 * Selector de periodo de HU-23 (SCRUM-35 / SCRUM-145).
 *
 * Va aparte de `PanelDeKpis` y no adentro porque los metodos de HU-22 no se
 * pueden reusar para esto, y conviene que se vea:
 *
 * - `elegirVentana()` espera CUALQUIER GET a /api/kpis. Alcanzaba en HU-22, que
 *   solo iba de 30 a 7. Acá no: el refresco de fondo dispara pedidos que no se
 *   pidieron (no mueve `aria-busy`, a proposito), y escribir un rango de dos
 *   campos dispara un pedido INTERMEDIO por el extremo que ya estaba. Un
 *   `waitForResponse` laxo resuelve con la respuesta equivocada y el test afirma
 *   sobre otro periodo. Todo lo de acá matchea los PARAMETROS esperados.
 * - `ventana(dias)` solo encuentra los botones "N días": no sirve para "Hoy",
 *   "Esta semana", "Este mes" ni "Personalizado".
 *
 * Los dos se dejan intactos: HU-22 los usa y le funcionan.
 */
export class SelectorDePeriodo {
  constructor(page, panel) {
    this.page = page;
    this.panel = panel;

    this.contenedor = page.getByTestId("kpis-selector");
    this.personalizado = page.getByTestId("periodo-personalizado");
    this.desde = page.getByTestId("periodo-desde");
    this.hasta = page.getByTestId("periodo-hasta");

    // Los cuatro carteles del periodo. Se parecen y significan cosas distintas,
    // asi que cada test afirma el que espera Y LA AUSENCIA DEL HERMANO:
    //   vigente       el periodo efectivo, leido de la RESPUESTA
    //   recortado     el backend recorto `dias` al tope: 200, SIN alert
    //   error         el backend rechazo el rango con 400: CON alert
    //   rangoInvalido el CLIENTE paro el rango y no se pidio nada: CON alert
    this.vigente = page.getByTestId("kpis-periodo-vigente");
    this.recortado = page.getByTestId("kpis-periodo-recortado");
    this.error = page.getByTestId("kpis-periodo-error");
    this.rangoInvalido = page.getByTestId("kpis-periodo-rango-invalido");
  }

  boton(id) {
    return this.page.getByTestId(`periodo-${id}`);
  }

  /**
   * Un predicado de `waitForResponse` que exige LOS PARAMETROS de ese periodo.
   *
   * `{}` (el preset de 30 dias) exige que no viaje NINGUNO de los tres: la URL
   * queda `/api/kpis` pelada, que es tambien el primer pedido de la pagina. Un
   * predicado que esperara `dias=30` no resolveria nunca.
   */
  esperarPedido(params) {
    return this.page.waitForResponse((respuesta) => {
      const peticion = respuesta.request();
      if (peticion.method() !== "GET") return false;

      const url = new URL(respuesta.url());
      if (url.pathname !== "/api/kpis") return false;

      for (const clave of ["dias", "desde", "hasta"]) {
        if ((url.searchParams.get(clave) ?? null) !== (params[clave] ?? null)) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Toca un preset y espera LA respuesta de ese periodo. Devuelve la respuesta.
   *
   * No sirve para el preset que ya esta elegido: `elegirPreset` del Frontend
   * guarda con `if (periodo.id !== id)` a proposito, asi que ese click no
   * dispara nada y la espera se cuelga. Para eso esta `tocarSinPedido`.
   */
  async elegir(id, params) {
    const respuesta = this.esperarPedido(params);
    await this.boton(id).click();
    const recibida = await respuesta;
    await this.panel.esperarCarga();
    return recibida;
  }

  /**
   * Toca algo que NO tiene que disparar ningun pedido, y lo comprueba.
   *
   * `pedidos` es el array vivo de `contarPedidos`, engachado antes del `goto`.
   * Se afirma contra la cantidad que ya habia, no contra cero: la carga inicial
   * de la pagina ya hizo el suyo.
   */
  async tocarSinPedido(locator, pedidos) {
    const antes = pedidos.length;
    await locator.click();
    // No hay evento que esperar —justamente—, asi que se le da tiempo a que el
    // pedido salga si fuera a salir. 1 s es de sobra: el pedido se dispara en el
    // efecto, en el mismo tick del render.
    //
    // Y NO ES FLAKY por el refresco de fondo, aunque lo parezca: ese pedido
    // seria indistinguible de este por la URL (es el mismo periodo, que es justo
    // el pedido duplicado que la guarda del Frontend evita). Lo que lo descarta
    // es el reloj: `CADENCIA_DE_REFRESCO_MS` son 60 s y el timeout de un test
    // son 45 s, asi que el tick no puede caer dentro de un test. El otro
    // disparador, `focus`, tampoco: la pagina ya esta enfocada y un click no
    // vuelve a emitirlo. Si alguna vez la cadencia baja de 45 s, esto se rompe
    // y hay que repensarlo, no alargar ni acortar esta espera.
    await this.page.waitForTimeout(1000);
    expect(
      pedidos.slice(antes),
      "este click no tenia que disparar ningun pedido a /api/kpis",
    ).toEqual([]);
  }

  /**
   * Abre "Personalizado". ABRIRLO YA DISPARA UN PEDIDO: propone hoy/hoy y pide
   * ese dia. Los inputs de fecha no existen hasta que esto corre.
   */
  async abrir(paramsDeHoy) {
    await expect(this.personalizado).toHaveAttribute("aria-expanded", "false");
    const respuesta = await this.elegir("personalizado", paramsDeHoy);
    await expect(this.personalizado).toHaveAttribute("aria-expanded", "true");
    await expect(this.desde).toBeVisible();
    await expect(this.hasta).toBeVisible();
    return respuesta;
  }

  /**
   * Escribe un rango a mano y espera la respuesta DEL RANGO FINAL.
   *
   * EL ORDEN DE LOS DOS CAMPOS NO ES ARBITRARIO. Dos razones:
   *
   * 1. El Frontend pide en CADA cambio de extremo (`cambiarExtremo` llama a
   *    `elegir` en cada `onChange`). Al abrir queda hoy/hoy, asi que escribir
   *    solo `desde` deja el rango [desde, hoy], que ya es valido y SE PIDE. Ese
   *    pedido intermedio es de un rango que nadie pidio; por eso se espera por
   *    los parametros finales y no por "cualquier /api/kpis".
   * 2. Los inputs llevan `min`/`max` cruzados (`desde` tiene `max={hasta}` y
   *    `hasta` tiene `min={desde}`). Escribiendo `desde` primero, el valor
   *    intermedio nunca viola ninguno de los dos para un rango valido que
   *    termina hoy o antes.
   *
   * Si los dos extremos son hoy, no hay nada que escribir: `abrir()` ya pidio
   * ese rango.
   */
  async escribirRango({ desde, hasta }, params) {
    const respuesta = this.esperarPedido(params);

    if ((await this.desde.inputValue()) !== desde) {
      await this.desde.fill(desde);
    }
    if ((await this.hasta.inputValue()) !== hasta) {
      await this.hasta.fill(hasta);
    }

    const recibida = await respuesta;
    await this.panel.esperarCarga();
    return recibida;
  }

  /** `data-granularidad` del grafico de ventas: "dia", "semana" o "mes". */
  granularidad() {
    return this.page.getByTestId("kpis-figura-ventas").getAttribute("data-granularidad");
  }
}

/** Como se llama la unidad de la serie en el caption de la tabla accesible. */
export const UNIDAD_DE_SERIE = { dia: "día", semana: "semana", mes: "mes" };

/**
 * Suma las barras de la tabla accesible del grafico de ventas.
 *
 * Se lee la tabla y no el SVG: las barras de Recharts no llevan su valor, y la
 * tabla `sr-only` es la que tiene los mismos datos. El caption CAMBIA con la
 * granularidad, asi que hay que pedir el titulo correcto o no se encuentra nada.
 */
export async function sumaDeBarras(page, granularidad) {
  const tabla = page.getByRole("table", {
    name: `Unidades vendidas por ${UNIDAD_DE_SERIE[granularidad]}`,
  });

  // `toHaveCount(1)` y no `toBeVisible()`: la tabla es `sr-only`, o sea 1x1 px
  // con `clip`. Playwright la da por visible porque tiene caja, pero afirmar
  // eso seria afirmar algo que no significa nada. Lo que importa es que exista
  // UNA con ese caption — si la granularidad cambio, el caption cambio y acá da
  // cero, que es el fallo que se quiere ver.
  await expect(tabla).toHaveCount(1);

  // `allTextContents` y no `allInnerTexts`: `innerText` depende del render y
  // esta tabla esta oculta para la vista.
  const celdas = await tabla.locator("tbody tr td:last-child").allTextContents();

  return celdas.reduce(
    // es-AR separa los miles con PUNTO ("1.234"), que hay que sacar antes de
    // parsear o `Number("1.234")` da 1,234.
    (total, texto) => total + Number(texto.replace(/\./g, "").trim() || 0),
    0,
  );
}
