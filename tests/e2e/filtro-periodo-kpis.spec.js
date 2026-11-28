import { expect, test } from "../soporte/fixtures.js";
import { abrirComo, crearOtroComercio, sumarMiembro } from "../soporte/equipo.js";
import { venderViaApi } from "../soporte/alertas.js";
import { crearProductoViaApi } from "../soporte/datos.js";
import {
  PERIODO_SIN_DATOS,
  diaEnArgentina,
  escenarioDeKpis,
  leerKpisViaApi,
  paramsEsperados,
  diasEntre,
  queryDeRango,
  rangoDePeriodo,
  rangosDeBorde,
  sumarDias,
} from "../soporte/kpis.js";
import { contarPedidos } from "./soporte/red.js";
import { PanelDeKpis, SelectorDePeriodo, sumaDeBarras } from "./soporte/kpis.js";

/**
 * E2E de HU-23 — Filtrado de KPIs por periodo (SCRUM-35 / SCRUM-145).
 *
 * Criterio de la tarea de testing: «Pruebas de los filtros (rango valido,
 * fechas invertidas, periodo sin datos, limites del periodo) y verificacion
 * manual de los criterios de aceptacion.»
 *
 * ES LA PRIMERA VEZ QUE HU-23 CORRE CONTRA EL BACKEND REAL. El Backend la probo
 * con supertest y sin stack; el Frontend, con el service mockeado y relojes
 * falsos. Lo que agrega esta suite es el circuito completo: el selector resuelve
 * el periodo en el navegador, los instantes viajan por la URL atravesando Nginx,
 * el backend corta los dias en hora de Argentina sobre datos creados por el
 * flujo real, y la pantalla pinta lo que volvio.
 *
 * ---------------------------------------------------------------------------
 * QUE NO SE PRUEBA ACA, Y POR QUE (una linea cada uno)
 *
 * - La validacion y el calculo fino del periodo -> `Backend/tests/kpis.test.js`
 *   y `kpis.service.test.js`, que corren fechas en la base sin stack.
 * - El render de cada estado aislado -> `Frontend/src/components/SeccionKpis.test.jsx`
 *   y `services/periodos.test.js`, que mockean el service y pueden congelar el
 *   reloj, que es lo que aca no se puede hacer (ver abajo).
 * - Los 400 del contrato (rango > 366, `dias` + rango juntos, un solo extremo,
 *   fecha sin zona) -> `tests/api/kpis.spec.js`. Por la UI son INALCANZABLES: el
 *   cliente para el rango invertido y el que se pasa del tope antes de pedir, y
 *   `parametrosDePeriodo` devuelve una forma o la otra pero nunca las dos.
 *
 * ---------------------------------------------------------------------------
 * LAS FECHAS: POR QUE LOS PRESETS Y LOS DATOS SE PRUEBAN POR SEPARADO
 *
 * La regla del repo es fechas fijas y nunca relativas a "hoy". Pero:
 *
 * - "Esta semana" y "Este mes" se resuelven CONTRA EL DIA EN QUE SE LOS TOCA,
 *   asi que unos fixtures con fechas fijas nunca caerian adentro, y el rango
 *   esperado cambia segun el dia en que corra la CI.
 * - `movimiento.fecha` es `defaultNow()` y ni el service ni el POST aceptan una
 *   fecha, asi que TODO movimiento creado por el flujo real es de hoy. No hay
 *   forma de armar un libro repartido en varios dias sin insertar filas a mano,
 *   que es justo lo que este repo no hace.
 *
 * Entonces se separan las dos cosas:
 *
 * 1. LOS PRESETS DE CALENDARIO SE AFIRMAN SOLO POR LOS PARAMETROS QUE EMITEN.
 *    Son deterministas dado el reloj, y lo esperado se calcula en Node con la
 *    zona explicita (`paramsEsperados`), NO preguntandoselo a la pagina: si el
 *    Frontend resolviera la semana de otra manera, preguntarle daria verde.
 * 2. LAS AFIRMACIONES SOBRE DATOS VAN POR "Personalizado", con los dias
 *    anclados a "hoy en Argentina" mas un corrimiento.
 *
 * Lo fijo y literal se conserva donde si vale: `PERIODO_SIN_DATOS` (enero de
 * 2026, anterior al primer commit del proyecto), que es el periodo que tiene que
 * dejar los datos AFUERA. Mismo criterio que `PERIODO_SIN_COMPRAS` de HU-21.
 *
 * Se descarto congelar el reloj del navegador: el "hoy" del backend no se
 * congela, asi que quedarian dos relojes distintos y el desfasaje seria el bug.
 *
 * ---------------------------------------------------------------------------
 * LAS ESPERAS
 *
 * `panel.esperarCarga()` espera `aria-busy="false"`. NO se espera a que
 * desaparezca `kpis-cargando`: ese cartel existe solo en la PRIMERA carga; al
 * cambiar de periodo los datos anteriores quedan a la vista atenuados y
 * `kpis-actualizado` dice "Actualizando…".
 *
 * Y `aria-busy` NO SE MUEVE en el refresco de fondo (cada 60 s con la pestaña
 * visible, y en el acto al volver a la pestaña). Por eso ningun test de acá
 * afirma CANTIDAD de pedidos salvo cuando la afirmacion es "ninguno", ni ata una
 * espera al tick del refresco.
 */

/** Un comercio con una sola venta de hoy. Mas barato que `escenarioDeKpis`. */
async function unaVentaDeHoy(api, { unidades = 4 } = {}) {
  const producto = await crearProductoViaApi(api, {
    nombre: `Yerba HU23 ${Date.now() % 100000}`,
    umbralMinimo: "5",
    stockActual: "30",
  });

  await venderViaApi(api, { productoId: producto.id, cantidad: unidades });

  return producto;
}

test.describe("HU-23 — Filtrado de KPIs por período", () => {
  test("arranca en 30 días sin query y al cambiar de ventana se repintan los tres bloques", async ({
    page,
    api,
  }) => {
    await escenarioDeKpis(api);

    // Enganchado ANTES del goto, o se pierde el pedido de la carga inicial, que
    // es justo el que interesa.
    const pedidos = contarPedidos(page, "/api/kpis", "GET");

    const panel = new PanelDeKpis(page);
    const selector = new SelectorDePeriodo(page, panel);
    await panel.ir();

    // EL PRIMER PEDIDO VA SIN QUERY. "30 días" es el periodo inicial y no manda
    // ningun parametro: la URL queda `/api/kpis` pelada. Un `waitForResponse`
    // que esperara `dias=30` no resolveria nunca.
    expect(pedidos.length, "la pagina tiene que pedir los KPIs al entrar").toBeGreaterThan(0);
    expect(new URL(pedidos[0]).search, "el primer pedido va sin query").toBe("");

    await expect(selector.contenedor).toBeVisible();
    await expect(panel.ventana(30)).toHaveAttribute("aria-pressed", "true");
    await expect(selector.vigente).toHaveText("los últimos 30 días");

    // Los tres bloques, con los numeros del escenario en la ventana de 30.
    await expect(panel.valor("kpi-productos")).toHaveText("3");
    await expect(panel.valor("kpi-unidades-vendidas")).toHaveText("9");
    await expect(panel.valor("kpi-compras")).toHaveText("2");

    // Y el cambio a otra ventana rodante.
    const respuesta = await selector.elegir("7", paramsEsperados("7"));
    expect(new URL(respuesta.url()).searchParams.get("dias")).toBe("7");

    const cuerpo = await respuesta.json();
    expect(cuerpo.periodo.dias).toBe(7);

    await expect(panel.ventana(7)).toHaveAttribute("aria-pressed", "true");
    await expect(panel.ventana(30)).toHaveAttribute("aria-pressed", "false");

    // `kpis-periodo-vigente` sale de la RESPUESTA, no de lo que se pidio.
    await expect(selector.vigente).toHaveText(`los últimos ${cuerpo.periodo.dias} días`);
    await expect(
      page.getByRole("heading", { name: "Rotación · últimos 7 días" }),
    ).toBeVisible();

    // Los tres bloques repintados. Todo el escenario es de hoy, asi que entra
    // igual en la ventana de 7: lo que se verifica es que se volvieron a pintar
    // con los numeros de ESTA respuesta, no que cambien de valor.
    await expect(panel.valor("kpi-unidades-vendidas")).toHaveText(
      String(cuerpo.rotacion.unidadesVendidas),
    );
    await expect(panel.valor("kpi-compras")).toHaveText(
      String(cuerpo.comprasPorProveedor.compras),
    );
    await expect(panel.valor("kpi-productos")).toHaveText(String(cuerpo.stock.productos));

    await expect(panel.error).toHaveCount(0);
    await expect(selector.error).toHaveCount(0);
  });

  /**
   * El corazon de la HU del lado del cliente: que cada boton emita los instantes
   * que corresponden, con el offset de Argentina y los dos extremos inclusive.
   *
   * EL DOMINGO ES EL CASO QUE MAS SE ROMPE y se cubre sin poder elegir el dia:
   * `paramsEsperados` replica la regla completa (el domingo pertenece a la
   * semana que TERMINA, asi que su lunes esta seis dias atras), y el dia que la
   * CI corra un domingo este test lo ejercita de verdad. La regla en si, para
   * los siete dias de la semana, la cubre `periodos.test.js` del Frontend, que
   * puede pasarle el dia por parametro.
   */
  test("cada preset manda los instantes resueltos del día en que se lo toca", async ({
    page,
    api,
  }) => {
    await unaVentaDeHoy(api);

    const panel = new PanelDeKpis(page);
    const selector = new SelectorDePeriodo(page, panel);
    await panel.ir();

    // El dia se lee antes y despues de la vuelta entera. Son el mismo salvo que
    // la corrida cruce la medianoche justo en el medio; si eso pasa, lo esperado
    // se recalcula con el dia nuevo en vez de caer por algo que no es un bug.
    const alEmpezar = diaEnArgentina();

    // "30 días" se saltea: es el periodo inicial y tocarlo no dispara nada
    // (lo cubre el test siguiente).
    for (const id of ["hoy", "7", "90", "semana", "mes"]) {
      const respuesta = await selector.elegir(id, paramsEsperados(id, alEmpezar));
      const url = new URL(respuesta.url());

      const esperado = paramsEsperados(id, alEmpezar);
      const recibido = Object.fromEntries(url.searchParams);

      // `elegir` ya matcheo los parametros para esperar ESA respuesta; esto
      // afirma ademas que no viajo NADA de mas (un `comercioId`, por ejemplo,
      // que el contrato dice que no existe).
      expect(recibido, `parametros del preset "${id}"`).toEqual(esperado);

      // El ":" y el "-" del offset viajan encodeados, que es lo que hace
      // `URLSearchParams`. Se afirma sobre la query cruda, no sobre lo parseado.
      if (esperado.desde) {
        expect(url.search).toContain("%3A");
        expect(url.search).toContain(encodeURIComponent("-03:00"));
      }

      await expect(panel.error).toHaveCount(0);
    }

    expect(
      diaEnArgentina(),
      "la corrida cruzo la medianoche en hora de Argentina: volvé a correrlo",
    ).toBe(alEmpezar);
  });

  /**
   * Es deliberado y hay que fijarlo, porque un page object que haga click y
   * despues `waitForResponse` se cuelga para siempre. `elegirPreset` del
   * Frontend guarda con `if (periodo.id !== id)`, y `abrirPersonalizado` con
   * `if (periodo.id !== ID_PERSONALIZADO)`: los DOS botones tienen la guarda.
   */
  test("tocar el período que ya está elegido no dispara ningún pedido", async ({
    page,
    api,
  }) => {
    await unaVentaDeHoy(api);

    const pedidos = contarPedidos(page, "/api/kpis", "GET");
    const panel = new PanelDeKpis(page);
    const selector = new SelectorDePeriodo(page, panel);
    await panel.ir();

    // El inicial, 30 días.
    await selector.tocarSinPedido(panel.ventana(30), pedidos);

    // Y otro cualquiera, dos veces: la segunda no pide.
    await selector.elegir("7", paramsEsperados("7"));
    await selector.tocarSinPedido(panel.ventana(7), pedidos);

    // "Personalizado" tambien, que es el que el reporte no mencionaba.
    await selector.abrir(rangoDePeriodo(diaEnArgentina(), diaEnArgentina()));
    await selector.tocarSinPedido(selector.personalizado, pedidos);
    // Y sigue abierto y usable: la guarda es sobre el pedido, no sobre el panel.
    await expect(selector.personalizado).toHaveAttribute("aria-expanded", "true");
    await expect(selector.desde).toBeVisible();
  });

  /**
   * Rango valido por "Personalizado", con datos adentro.
   *
   * Incluye la vuelta de la conversion a UTC, que es el off-by-one que esta HU
   * arriesga de punta a punta: el `hasta` que se manda como 23:59:59.000-03:00
   * VUELVE en UTC con `Z` (02:59:59.000Z del dia siguiente). Es el mismo
   * instante, y la pantalla lo formatea con `timeZone`, asi que el titulo del
   * bloque tiene que decir el dia que se pidio y no el siguiente.
   *
   * OJO: el que lleva las fechas es el TITULO DEL BLOQUE («Rotación · 23/11/2026
   * al 28/11/2026»), no `kpis-periodo-vigente`, que con un rango dice la frase
   * fija "el período elegido".
   */
  test("un rango por «Personalizado» trae los datos del rango y lo rotula en hora de Argentina", async ({
    page,
    api,
  }) => {
    const producto = await unaVentaDeHoy(api, { unidades: 4 });
    const { terminaHoy } = rangosDeBorde();

    const panel = new PanelDeKpis(page);
    const selector = new SelectorDePeriodo(page, panel);
    await panel.ir();

    await selector.abrir(rangoDePeriodo(terminaHoy.hasta, terminaHoy.hasta));
    const respuesta = await selector.escribirRango(
      terminaHoy,
      rangoDePeriodo(terminaHoy.desde, terminaHoy.hasta),
    );

    const cuerpo = await respuesta.json();

    // Los dos extremos del rango, tal como los recibio el backend, vuelven en
    // UTC con Z. El `hasta` de las 23:59:59-03:00 es 02:59:59Z del dia SIGUIENTE.
    expect(cuerpo.periodo.hasta).toBe(
      new Date(`${terminaHoy.hasta}T23:59:59.000-03:00`).toISOString(),
    );
    expect(cuerpo.periodo.hasta.endsWith("Z")).toBe(true);
    expect(cuerpo.periodo.dias).toBe(6);
    expect(cuerpo.periodo.zonaHoraria).toBe("America/Argentina/Buenos_Aires");

    // Y la pantalla igual dice el dia que se pidio, no el de la representacion.
    const comoSeLee = (dia) => dia.split("-").reverse().join("/");
    await expect(
      page.getByRole("heading", {
        name: `Rotación · ${comoSeLee(terminaHoy.desde)} al ${comoSeLee(terminaHoy.hasta)}`,
      }),
    ).toBeVisible();
    await expect(selector.vigente).toHaveText("el período elegido");

    // La venta esta adentro, y los numeros son los de la API.
    await expect(panel.valor("kpi-unidades-vendidas")).toHaveText("4");
    await expect(panel.valor("kpi-ventas")).toHaveText("1");
    await expect(panel.masVendido(producto.id)).toBeVisible();
    expect((await leerKpisViaApi(api, queryDeRango(terminaHoy))).rotacion).toMatchObject({
      ventas: 1,
      unidadesVendidas: 4,
    });

    await expect(panel.rotacionVacia).toHaveCount(0);
    await expect(selector.error).toHaveCount(0);
    await expect(selector.rangoInvalido).toHaveCount(0);
  });

  /**
   * Fechas invertidas: LAS PARA EL CLIENTE. No llega ningun pedido al backend,
   * asi que aparece `kpis-periodo-rango-invalido` y NO `kpis-periodo-error`, que
   * es el 400 del backend. Los dos llevan `role="alert"` y se confunden.
   *
   * Se invierte moviendo UN solo extremo, que es lo minimo: al abrir queda
   * hoy/hoy, y poner `hasta` en ayer ya deja el rango al reves.
   */
  test("fechas invertidas: el cliente para el rango y no sale ningún pedido", async ({
    page,
    api,
  }) => {
    await unaVentaDeHoy(api);
    const hoy = diaEnArgentina();

    const pedidos = contarPedidos(page, "/api/kpis", "GET");
    const panel = new PanelDeKpis(page);
    const selector = new SelectorDePeriodo(page, panel);
    await panel.ir();

    await selector.abrir(rangoDePeriodo(hoy, hoy));

    const antes = pedidos.length;
    await selector.hasta.fill(sumarDias(hoy, -1));

    await expect(selector.rangoInvalido).toBeVisible();
    await expect(selector.rangoInvalido).toContainText(
      "La fecha «Desde» no puede ser posterior a «Hasta».",
    );

    // Lo central: NO SE GASTO EL VIAJE.
    expect(
      pedidos.slice(antes),
      "un rango al reves no tiene que llegar al backend",
    ).toEqual([]);

    // Y es el cartel del cliente, no el del backend.
    await expect(selector.error).toHaveCount(0);
    await expect(panel.error).toHaveCount(0);

    // Un rango a medio escribir NO es un error y no avisa nada: el cliente no
    // gasta el viaje y tampoco reta a nadie por algo que todavia no esta mal.
    await selector.desde.fill("");
    await expect(selector.rangoInvalido).toHaveCount(0);
    expect(pedidos.slice(antes), "con un solo extremo no se pide nada").toEqual([]);
  });

  /**
   * El otro rango que para el CLIENTE: el que se pasa del tope de 366 dias.
   *
   * Va aparte del rango invertido porque son las dos ramas de `validarPeriodo` y
   * se rompen por separado, y porque el mensaje es el unico que dice un numero
   * calculado (cuantos dias abarca el que se eligio).
   *
   * LOS DOS TOPES NO SE COMPORTAN IGUAL, y es lo que mas se confunde de esta HU:
   * `dias` se recorta en silencio con un 200, pero un rango de mas de 366 dias
   * se RECHAZA. Y lo rechaza el cliente antes de pedir, asi que por pantalla se
   * ve `kpis-periodo-rango-invalido` y NUNCA el 400 del backend. El 400 existe y
   * esta cubierto, pero en tests/api/: para verlo hay que pegarle a la API
   * directo.
   */
  test("un rango de más de 366 días lo para el cliente, sin pedir nada", async ({
    page,
    api,
  }) => {
    await unaVentaDeHoy(api);
    const hoy = diaEnArgentina();

    const pedidos = contarPedidos(page, "/api/kpis", "GET");
    const panel = new PanelDeKpis(page);
    const selector = new SelectorDePeriodo(page, panel);
    await panel.ir();

    await selector.abrir(rangoDePeriodo(hoy, hoy));

    // 367 dias contando los dos extremos: uno mas que el tope.
    const desde = sumarDias(hoy, -366);
    expect(diasEntre(desde, hoy), "el rango de prueba abarca 367 dias").toBe(367);

    const antes = pedidos.length;
    await selector.desde.fill(desde);

    await expect(selector.rangoInvalido).toBeVisible();
    await expect(selector.rangoInvalido).toContainText(
      "El período no puede abarcar más de 366 días y el que elegiste abarca 367.",
    );
    expect(
      pedidos.slice(antes),
      "un rango que se pasa del tope no tiene que llegar al backend",
    ).toEqual([]);
    // Es el aviso del cliente, no el 400 del backend.
    await expect(selector.error).toHaveCount(0);

    // Y 366 EXACTOS SI PASAN: el borde esta donde dice estar, no uno antes.
    const justo = sumarDias(hoy, -365);
    expect(diasEntre(justo, hoy)).toBe(366);
    const respuesta = await selector.escribirRango(
      { desde: justo, hasta: hoy },
      rangoDePeriodo(justo, hoy),
    );

    expect(respuesta.status()).toBe(200);
    expect((await respuesta.json()).periodo.dias).toBe(366);
    await expect(selector.rangoInvalido).toHaveCount(0);
    await expect(selector.error).toHaveCount(0);
  });

  /**
   * Periodo sin datos = 200 con ceros, NUNCA un 404 ni un error.
   *
   * Los tres `*-vacio` NO llevan `role="alert"`, a diferencia de `kpis-error`.
   * Por eso se afirma, ademas de los tres carteles, que en la pantalla no hay
   * NINGUN alert: es la unica forma de que el test caiga si alguno de los tres
   * se convirtiera en uno.
   */
  test("un período sin datos muestra los tres vacíos, en 200 y sin ningún alert", async ({
    page,
    api,
  }) => {
    await escenarioDeKpis(api);

    const panel = new PanelDeKpis(page);
    const selector = new SelectorDePeriodo(page, panel);
    await panel.ir();

    await selector.abrir(rangoDePeriodo(diaEnArgentina(), diaEnArgentina()));
    const respuesta = await selector.escribirRango(
      PERIODO_SIN_DATOS,
      rangoDePeriodo(PERIODO_SIN_DATOS.desde, PERIODO_SIN_DATOS.hasta),
    );

    expect(respuesta.status(), "un periodo sin datos es 200, no 404").toBe(200);
    const cuerpo = await respuesta.json();
    expect(cuerpo.rotacion).toMatchObject({ ventas: 0, unidadesVendidas: 0 });
    expect(cuerpo.comprasPorProveedor).toMatchObject({ compras: 0, unidades: 0 });

    await expect(panel.valor("kpi-ventas")).toHaveText("0");
    await expect(panel.valor("kpi-unidades-vendidas")).toHaveText("0");
    await expect(panel.valor("kpi-compras")).toHaveText("0");
    await expect(panel.rotacionVacia).toBeVisible();
    await expect(panel.comprasVacias).toBeVisible();

    // EL STOCK NO SIGUE AL PERIODO: enero de 2026 no tiene ventas ni compras,
    // pero los productos siguen existiendo hoy. `kpis-stock-vacio` NO aparece.
    await expect(panel.valor("kpi-productos")).toHaveText("3");
    await expect(panel.stockVacio).toHaveCount(0);

    // NI UN SOLO ALERT EN LA SECCION. Acotado a `kpis` y no a la pagina entera a
    // proposito: Inicio monta tambien el panel de alertas de HU-17 y las
    // sugerencias de HU-27, y los dos pintan un `AvisoDeError` con
    // `role="alert"` si su propio pedido falla. Sin acotar, un ETIMEDOUT de Neon
    // en otro panel haria caer este test por algo que no tiene que ver con el
    // periodo — y, peor, lo haria caer por el motivo contrario al que se busca.
    await expect(panel.contenedor.getByRole("alert")).toHaveCount(0);
    await expect(panel.error).toHaveCount(0);
    await expect(selector.error).toHaveCount(0);
    await expect(selector.rangoInvalido).toHaveCount(0);
  });

  /**
   * Los limites del periodo: LOS DOS EXTREMOS SON INCLUSIVE.
   *
   * No se puede elegir la fecha de un movimiento (`defaultNow()`), asi que en vez
   * de repartir fixtures por dias se apoya cada extremo en hoy, y cada rango
   * aisla UNO:
   *
   *   [hoy-5, hoy]    incluye -> `hasta` es inclusive
   *   [hoy, hoy+5]    incluye -> `desde` es inclusive
   *   [hoy, hoy]      incluye -> los dos a la vez, en un periodo de 1 dia
   *   [hoy-5, hoy-1]  excluye -> el borde se nota de verdad
   *
   * El ultimo es el que le da valor a los otros tres: sin un rango que EXCLUYA,
   * los tres primeros pasarian igual con un backend que ignorara las fechas
   * (que es exactamente lo que hace el backend de `dev` hoy).
   */
  test("los dos extremos del rango son inclusive, y un día antes ya queda afuera", async ({
    page,
    api,
  }) => {
    await unaVentaDeHoy(api, { unidades: 7 });
    const { hoy, terminaHoy, empiezaHoy, soloHoy, terminaAyer } = rangosDeBorde();

    const panel = new PanelDeKpis(page);
    const selector = new SelectorDePeriodo(page, panel);
    await panel.ir();
    await selector.abrir(rangoDePeriodo(hoy, hoy));

    for (const [rango, unidades, dias, que] of [
      [terminaHoy, "7", 6, "el `hasta` incluye su propio día"],
      [empiezaHoy, "7", 6, "el `desde` incluye su propio día"],
      [soloHoy, "7", 1, "un rango de un día incluye los dos extremos"],
      [terminaAyer, "0", 5, "un día antes ya queda afuera"],
    ]) {
      const respuesta = await selector.escribirRango(
        rango,
        rangoDePeriodo(rango.desde, rango.hasta),
      );
      const cuerpo = await respuesta.json();

      expect(cuerpo.periodo.dias, que).toBe(dias);
      expect(String(cuerpo.rotacion.unidadesVendidas), que).toBe(unidades);
      await expect(panel.valor("kpi-unidades-vendidas"), que).toHaveText(unidades);
      await expect(selector.error, que).toHaveCount(0);
      await expect(selector.rangoInvalido, que).toHaveCount(0);
    }

    // Y el que excluye deja el bloque en su estado vacio, sin alert.
    await expect(panel.rotacionVacia).toBeVisible();
    await expect(panel.contenedor.getByRole("alert")).toHaveCount(0);
  });

  /**
   * Las tres granularidades del grafico, con la suma de las barras contra la
   * tarjeta. El agrupado no descarta ningun dia, asi que la suma tiene que dar
   * `rotacion.unidadesVendidas` EN LAS TRES.
   *
   * EL CAPTION DE LA TABLA ACCESIBLE CAMBIA con la granularidad, asi que un
   * `getByRole("table", { name: "Unidades vendidas por día" })` solo encuentra
   * algo en los periodos cortos. Es por donde se rompe un test escrito para 30
   * dias y reusado para 90.
   *
   * La de "mes" solo se alcanza por "Personalizado": el preset mas largo son 90
   * dias, que ya es `semana` (90 > 62) y no llega a `mes` (> 180).
   */
  test("el gráfico agrupa por día, por semana o por mes según el largo del período", async ({
    page,
    api,
  }) => {
    await unaVentaDeHoy(api, { unidades: 5 });
    const hoy = diaEnArgentina();

    const panel = new PanelDeKpis(page);
    const selector = new SelectorDePeriodo(page, panel);
    await panel.ir();

    // 30 dias: una barra por dia (30 <= 62).
    await expect(panel.valor("kpi-unidades-vendidas")).toHaveText("5");
    expect(await selector.granularidad()).toBe("dia");
    expect(await sumaDeBarras(page, "dia")).toBe(5);
    await expect(panel.tabla("Unidades vendidas por día").getByRole("row")).toHaveCount(31);

    // 90 dias: por semana de calendario (62 < 90 <= 180).
    const noventa = await (await selector.elegir("90", paramsEsperados("90"))).json();
    expect(noventa.periodo.dias).toBe(90);
    expect(await selector.granularidad()).toBe("semana");
    expect(await sumaDeBarras(page, "semana")).toBe(noventa.rotacion.unidadesVendidas);
    await expect(panel.tabla("Unidades vendidas por día")).toHaveCount(0);

    // Mas de 180: por mes. Solo por "Personalizado"; 200 dias entra en el tope
    // de 366 del backend, asi que es un 200 y no un 400.
    const largo = { desde: sumarDias(hoy, -199), hasta: hoy };
    await selector.abrir(rangoDePeriodo(hoy, hoy));
    const porMes = await (
      await selector.escribirRango(largo, rangoDePeriodo(largo.desde, largo.hasta))
    ).json();

    expect(porMes.periodo.dias).toBe(200);
    expect(porMes.rotacion.porDia).toHaveLength(200);
    expect(await selector.granularidad()).toBe("mes");
    expect(await sumaDeBarras(page, "mes")).toBe(porMes.rotacion.unidadesVendidas);
    await expect(panel.tabla("Unidades vendidas por semana")).toHaveCount(0);

    // `porDia` siempre viene del mas viejo al mas nuevo, en las tres.
    const fechas = porMes.rotacion.porDia.map((dia) => dia.fecha);
    expect(fechas).toEqual([...fechas].sort());
    expect(fechas.at(0)).toBe(largo.desde);
    expect(fechas.at(-1)).toBe(largo.hasta);
  });

  /**
   * El riesgo mas grande de la pantalla: que alguien con el periodo en enero lea
   * las unidades de stock como las que tenia en enero. `stock` es SIEMPRE el
   * estado de hoy, y el badge lo rotula.
   */
  test("el stock no se mueve al cambiar de período, y lo dice", async ({ page, api }) => {
    const { esperado } = await escenarioDeKpis(api);

    const panel = new PanelDeKpis(page);
    const selector = new SelectorDePeriodo(page, panel);
    await panel.ir();

    const stockDeHoy = {
      productos: String(esperado.stock.productos),
      unidades: String(esperado.stock.unidades),
      sinStock: String(esperado.stock.sinStock),
      bajoUmbral: String(esperado.stock.bajoUmbral),
    };

    const comprobarStock = async (donde) => {
      await expect(panel.valor("kpi-productos"), donde).toHaveText(stockDeHoy.productos);
      await expect(panel.valor("kpi-unidades-stock"), donde).toHaveText(stockDeHoy.unidades);
      await expect(panel.valor("kpi-sin-stock"), donde).toHaveText(stockDeHoy.sinStock);
      await expect(panel.valor("kpi-bajo-umbral"), donde).toHaveText(stockDeHoy.bajoUmbral);
      // El badge, en todos los periodos.
      await expect(panel.page.getByTestId("kpis-stock-alcance"), donde).toBeVisible();
      await expect(
        panel.page.getByTestId("kpis-stock-alcance"),
        donde,
      ).toHaveText("Siempre el stock de hoy");
      // Y el titulo del bloque NO lleva periodo, al contrario de los otros dos.
      await expect(
        panel.page.getByRole("heading", { name: "Estado del stock" }),
        donde,
      ).toBeVisible();
    };

    await comprobarStock("30 días");

    const hoy = await (await selector.elegir("hoy", paramsEsperados("hoy"))).json();
    await comprobarStock("Hoy");
    expect(hoy.stock.alcance).toBe("actual");

    // Y en un periodo del pasado sin ninguna actividad, donde la confusion
    // seria mas grave: rotacion y compras en cero, stock intacto.
    await selector.abrir(rangoDePeriodo(diaEnArgentina(), diaEnArgentina()));
    const enero = await (
      await selector.escribirRango(
        PERIODO_SIN_DATOS,
        rangoDePeriodo(PERIODO_SIN_DATOS.desde, PERIODO_SIN_DATOS.hasta),
      )
    ).json();

    await comprobarStock("enero de 2026");
    expect(enero.stock).toMatchObject(esperado.stock);
    expect(enero.rotacion.unidadesVendidas).toBe(0);
    await expect(panel.rotacionVacia).toBeVisible();

    // Las tres categorias siguen siendo excluyentes y sumando el total, en todos
    // los periodos: es el invariante del bloque.
    expect(enero.stock.sinStock + enero.stock.bajoUmbral + enero.stock.normal).toBe(
      enero.stock.productos,
    );
  });

  /**
   * El recorte silencioso de `dias` al tope: 200, `kpis-periodo-recortado` y SIN
   * `role="alert"`. Es el par que se confunde con el rechazo del rango por 366,
   * que si es un 400 y si lleva alert.
   *
   * POR QUE HACE FALTA REESCRIBIR LA QUERY. Ningun boton del selector pide mas
   * de 90, que es exactamente el tope del backend, asi que por la pantalla el
   * recorte NO SE PUEDE PROVOCAR. Lo que se reescribe es el PEDIDO, no la
   * respuesta: el que recorta sigue siendo el backend de verdad, y lo que se
   * verifica end-to-end son las dos mitades reales —que el backend recorta con
   * 200 y que la pantalla detecta el desfasaje entre lo pedido y lo que volvio—.
   * La unica parte artificial es como se produce ese desfasaje.
   */
  test("el recorte silencioso de la ventana se avisa sin tratarlo como un error", async ({
    page,
    api,
  }) => {
    await unaVentaDeHoy(api);

    // Un predicado y no un glob: en los patrones de URL de Playwright el "?" no
    // es un comodin pero su tratamiento cambio entre versiones, y un patron que
    // no matchea nada dejaria el test pasando sin haber reescrito nada —o
    // colgado esperando `dias=365`—. Con una funcion no hay ambiguedad.
    await page.route(
      (url) => url.pathname === "/api/kpis" && url.searchParams.get("dias") === "7",
      async (ruta) => {
        const url = new URL(ruta.request().url());
        url.searchParams.set("dias", "365");
        await ruta.continue({ url: url.toString() });
      },
    );

    const panel = new PanelDeKpis(page);
    const selector = new SelectorDePeriodo(page, panel);
    await panel.ir();

    const respuesta = await selector.elegir("7", { dias: "365" });

    expect(respuesta.status(), "el recorte es un 200, no un 400").toBe(200);
    expect((await respuesta.json()).periodo.dias).toBe(90);

    await expect(selector.recortado).toBeVisible();
    await expect(selector.recortado).toContainText("el máximo es 90");

    // Informativo, NO un error: ni alert, ni `kpis-error`, ni `kpis-periodo-error`.
    await expect(panel.contenedor.getByRole("alert")).toHaveCount(0);
    await expect(panel.error).toHaveCount(0);
    await expect(selector.error).toHaveCount(0);
  });

  /**
   * El rol menos privilegiado. Se afirma por AUSENCIA del nodo y no por un
   * cartel: el gate es por permiso efectivo y `permisosDe()` ni manda la clave
   * `kpi` para el empleado, asi que la seccion no se monta. No esta vacia: NO
   * ESTA.
   *
   * HU-22 ya cubre que `kpis` no exista y que no se dispare ningun pedido. Lo
   * que agrega este test es la superficie nueva de HU-23: que tampoco exista el
   * selector ni ninguno de sus botones.
   */
  test("el empleado no ve el selector de período, porque no ve la sección", async ({
    browser,
    playwright,
    api,
  }) => {
    await unaVentaDeHoy(api);
    const empleado = await sumarMiembro(playwright, api, { rol: "empleado" });
    const comoEmpleado = await abrirComo(browser, empleado.storageState);

    try {
      await comoEmpleado.page.goto("/");
      // Inicio carga: su panel de alertas si lo ve. Sin esto se afirmaria la
      // ausencia de algo que todavia no tuvo tiempo de montarse.
      await expect(comoEmpleado.page.getByTestId("alertas")).toHaveAttribute(
        "aria-busy",
        "false",
        { timeout: 25_000 },
      );

      await expect(comoEmpleado.page.getByTestId("kpis")).toHaveCount(0);
      await expect(comoEmpleado.page.getByTestId("kpis-selector")).toHaveCount(0);
      for (const id of ["hoy", "7", "30", "90", "semana", "mes", "personalizado"]) {
        await expect(comoEmpleado.page.getByTestId(`periodo-${id}`)).toHaveCount(0);
      }
      await expect(
        comoEmpleado.page.getByRole("group", { name: "Período de ventas y compras" }),
      ).toHaveCount(0);
    } finally {
      await comoEmpleado.context.close();
    }
  });

  /**
   * El aislamiento por `comercio_id` con un rango explicito.
   *
   * HU-22 ya lo cubre en el periodo por defecto. Lo que agrega esta HU es una
   * vía nueva para llegar al endpoint —`desde`/`hasta`— y el aislamiento tiene
   * que valer igual por ahi: el `comercio_id` sale de la sesion, y el param
   * `comercioId` no existe. Se le manda igual, para fijar que se descarta.
   */
  test("un rango no deja ver lo de otro comercio, ni mandando comercioId", async ({
    page,
    api,
    playwright,
  }) => {
    const otro = await crearOtroComercio(playwright);
    let ajeno;
    try {
      ajeno = await escenarioDeKpis(otro.api);
    } finally {
      await otro.api.dispose();
    }

    const mio = await unaVentaDeHoy(api, { unidades: 2 });
    const { terminaHoy } = rangosDeBorde();

    const panel = new PanelDeKpis(page);
    const selector = new SelectorDePeriodo(page, panel);
    await panel.ir();
    await selector.abrir(rangoDePeriodo(diaEnArgentina(), diaEnArgentina()));
    await selector.escribirRango(terminaHoy, rangoDePeriodo(terminaHoy.desde, terminaHoy.hasta));

    // Lo propio y nada mas: 1 producto, 2 unidades vendidas, 0 compras.
    await expect(panel.valor("kpi-productos")).toHaveText("1");
    await expect(panel.valor("kpi-unidades-vendidas")).toHaveText("2");
    await expect(panel.valor("kpi-compras")).toHaveText("0");
    await expect(panel.masVendido(mio.id)).toBeVisible();
    await expect(panel.masVendido(ajeno.yerba.id)).toHaveCount(0);

    // Y `comercioId` no existe en el contrato: se descarta, sea lo que sea. El
    // valor es arbitrario a proposito — lo que se fija es que el endpoint no lo
    // mire, no que rechace uno en particular.
    const conParamDeMas = await leerKpisViaApi(
      api,
      `${queryDeRango(terminaHoy)}&comercioId=el-comercio-de-al-lado`,
    );
    expect(conParamDeMas.stock.productos).toBe(1);
    expect(conParamDeMas.rotacion.unidadesVendidas).toBe(2);
  });

  /**
   * Los dias de cobertura cambian de REDACCION Y DE TESTID segun si el periodo
   * termina hoy, porque significan cosas distintas:
   *
   *   `kpis-cobertura`            el periodo TERMINA HOY -> "alcanza para N días"
   *   `kpis-cobertura-proyectada` NO termina hoy -> "al ritmo del período, el
   *                               stock de hoy alcanza para N días"
   *
   * El segundo no es un adorno: con un periodo historico el numero mezcla dos
   * momentos —el stock es de hoy y el ritmo es del periodo—, asi que leerlo como
   * "la cobertura que tenia en marzo" seria falso.
   *
   * COMO SE LLEGA A UN PERIODO QUE NO TERMINA HOY sin poder fechar un
   * movimiento: con un rango que se extiende al FUTURO. [hoy, hoy+5] incluye la
   * venta de hoy y su `hasta` no es hoy, que es exactamente la condicion. Un
   * rango del pasado no sirve: sin ventas adentro no hay fila de `masVendidos`
   * y no se renderiza ninguna cobertura.
   *
   * `kpis-cobertura-sin-ritmo` (`diasDeCobertura: null`) NO SE PUEDE ALCANZAR
   * POR LA PANTALLA, y conviene saberlo antes de buscarlo: es `null` solo si
   * `unidadesVendidas <= 0` (ver `diasDeCobertura` en el service), y las filas de
   * `masVendidos` salen justamente de los productos CON ventas en el periodo. O
   * sea que la condicion y el lugar donde se muestra se excluyen. Lo cubre
   * `SeccionKpis.test.jsx`, que puede mockear la respuesta.
   */
  test("la cobertura se rotula distinto cuando el período no termina hoy", async ({
    page,
    api,
  }) => {
    // Stock 31 y 30 vendidas: queda 1, y al ritmo del periodo no alcanza ni un
    // dia. Da el borde de `diasDeCobertura === 0`, que se redacta aparte de
    // "sin stock" (que es `stockActual <= 0`).
    const producto = await crearProductoViaApi(api, {
      nombre: `Yerba HU23 cobertura ${Date.now() % 100000}`,
      umbralMinimo: "5",
      stockActual: "31",
    });
    await venderViaApi(api, { productoId: producto.id, cantidad: 30 });

    const { hoy, terminaHoy, empiezaHoy } = rangosDeBorde();
    const panel = new PanelDeKpis(page);
    const selector = new SelectorDePeriodo(page, panel);
    await panel.ir();

    const fila = panel.masVendido(producto.id);

    // 1. Un periodo que TERMINA HOY: la cobertura se lee derecho.
    await selector.abrir(rangoDePeriodo(hoy, hoy));
    const deHoy = await (
      await selector.escribirRango(terminaHoy, rangoDePeriodo(terminaHoy.desde, terminaHoy.hasta))
    ).json();

    expect(deHoy.rotacion.masVendidos[0].diasDeCobertura).toBe(0);
    await expect(fila.getByTestId("kpis-cobertura")).toBeVisible();
    await expect(fila.getByTestId("kpis-cobertura")).toHaveText(
      "alcanza para menos de un día",
    );
    // Y NO el hermano proyectado.
    await expect(fila.getByTestId("kpis-cobertura-proyectada")).toHaveCount(0);

    // 2. Un periodo que NO termina hoy: la misma cuenta, otra redaccion.
    const alFuturo = await (
      await selector.escribirRango(empiezaHoy, rangoDePeriodo(empiezaHoy.desde, empiezaHoy.hasta))
    ).json();

    expect(alFuturo.rotacion.masVendidos[0].diasDeCobertura).toBe(0);
    await expect(fila.getByTestId("kpis-cobertura-proyectada")).toBeVisible();
    await expect(fila.getByTestId("kpis-cobertura-proyectada")).toHaveText(
      "al ritmo del período, el stock de hoy alcanza para menos de un día",
    );
    await expect(fila.getByTestId("kpis-cobertura")).toHaveCount(0);

    // Ninguna de las dos es un error.
    await expect(panel.contenedor.getByRole("alert")).toHaveCount(0);
  });

  /**
   * (c) de las verificaciones que el Frontend no pudo hacer: el selector de 7
   * botones en ancho de celular. Esta con `flex-wrap` y nadie lo vio andando.
   *
   * No es una captura decorativa: se afirma que no hay scroll horizontal —que es
   * como se rompe un selector de 7 botones en 375 px— y que se apilo en mas de
   * una fila, porque en una sola no entrarian. Y que sigue siendo usable:
   * se toca un preset y pide.
   */
  test("en ancho de celular el selector se apila y no desborda", async ({ page, api }) => {
    await unaVentaDeHoy(api);
    await page.setViewportSize({ width: 375, height: 812 });

    const panel = new PanelDeKpis(page);
    const selector = new SelectorDePeriodo(page, panel);
    await panel.ir();

    await expect(selector.contenedor).toBeVisible();

    const medidas = await selector.contenedor.evaluate((nodo) => {
      const botones = [...nodo.querySelectorAll("[data-testid^='periodo-']")];
      return {
        desborda: nodo.scrollWidth > nodo.clientWidth + 1,
        botones: botones.length,
        // Cuantas filas distintas: las coordenadas `y` unicas de los botones.
        filas: new Set(botones.map((boton) => Math.round(boton.getBoundingClientRect().top))).size,
        anchoDeLaPagina: document.documentElement.scrollWidth,
        anchoVisible: document.documentElement.clientWidth,
      };
    });

    expect(medidas.botones, "los 7 botones del selector").toBe(7);
    expect(medidas.desborda, "el selector no tiene que desbordar a lo ancho").toBe(false);
    expect(medidas.filas, "en 375 px los 7 botones no entran en una fila").toBeGreaterThan(1);
    expect(
      medidas.anchoDeLaPagina,
      "la pagina no tiene que tener scroll horizontal",
    ).toBeLessThanOrEqual(medidas.anchoVisible + 1);

    for (const id of ["hoy", "7", "30", "90", "semana", "mes", "personalizado"]) {
      await expect(page.getByTestId(`periodo-${id}`)).toBeVisible();
    }

    // Y se puede usar de verdad desde ahi.
    await selector.elegir("7", paramsEsperados("7"));
    await expect(panel.ventana(7)).toHaveAttribute("aria-pressed", "true");

    // Adjunta al reporte y no un archivo suelto: `test-results/` esta en el
    // .gitignore y la CI solo lo sube `if: failure()`, asi que en una corrida
    // verde —que es cuando se quiere mirar— no quedaria en ningun lado. Como
    // attachment entra en el reporte HTML de todas las corridas, que es lo que
    // hace entregable la verificacion visual que el Frontend no pudo hacer.
    await test.info().attach("selector de período en 375 px", {
      body: await selector.contenedor.screenshot(),
      contentType: "image/png",
    });
  });

  /**
   * (d) de las verificaciones heredadas: el RNF2 de menos de 2 s, pero medido
   * sobre un CAMBIO DE PERIODO y no sobre la primera carga, que es lo que ya
   * mide HU-22.
   *
   * Es la medicion que esta HU necesita: la cache del backend es por comercio Y
   * PERIODO, asi que el primer pedido de un periodo nuevo es siempre un calculo
   * entero. Se mide en el navegador, desde que sale el pedido hasta que la
   * seccion termino de cargar.
   */
  test("RNF2: cambiar de período también carga en menos de dos segundos", async ({
    page,
    api,
  }) => {
    await escenarioDeKpis(api);

    const panel = new PanelDeKpis(page);
    const selector = new SelectorDePeriodo(page, panel);
    // La primera visita deja abiertas las conexiones del pool a Neon. Abrir una
    // nueva cuesta ~1,4 s y no depende de esta HU; sin esto el test cae o pasa
    // segun la suerte del pool. Mismo recaudo que el RNF2 de HU-22.
    await panel.ir();

    const hoy = diaEnArgentina();
    // Un rango que el backend no vio nunca, para que no haya cache que acertar.
    const rango = { desde: sumarDias(hoy, -43), hasta: hoy };

    await page.evaluate(() => performance.clearResourceTimings());
    await selector.abrir(rangoDePeriodo(hoy, hoy));
    await selector.escribirRango(rango, rangoDePeriodo(rango.desde, rango.hasta));

    const medido = await page.evaluate(() => {
      const pedidos = performance
        .getEntriesByType("resource")
        .filter((entrada) => entrada.name.includes("/api/kpis"));
      const ultimo = pedidos.at(-1);
      return ultimo ? ultimo.duration : null;
    });

    test.info().annotations.push({
      type: "RNF2 · cambio de período (cálculo entero, sin caché)",
      description: medido === null ? "no se midió" : `${Math.round(medido)} ms`,
    });

    expect(medido, "no se encontró el pedido a /api/kpis").not.toBeNull();
    expect(medido, `el cambio de período tardó ${Math.round(medido ?? 0)} ms`).toBeLessThan(2000);
  });
});
