import { expect, test } from "../soporte/fixtures.js";
import { BASE_URL } from "../soporte/entorno.js";
import { venderViaApi } from "../soporte/alertas.js";
import { crearOtroComercio, sumarMiembro } from "../soporte/equipo.js";
import {
  diaEnArgentina,
  diasEntre,
  escenarioDeKpis,
  leerKpisViaApi,
  pedirKpis,
  queryDeRango,
  rangoDePeriodo,
  sumarDias,
} from "../soporte/kpis.js";

/**
 * HU-22 — Lo del contrato de `GET /api/kpis` que no se ve en el navegador.
 *
 * Chico a proposito, como el de HU-17: `Backend/tests/kpis.test.js` ya cubre la
 * validacion de `dias` y cada numero. Lo que queda es lo que solo tiene sentido
 * con el stack entero en el medio:
 *
 * 1. RNF2 MEDIDO EN EL ENDPOINT, a traves de Nginx y contra Neon, con la cache
 *    del backend vacia para esa ventana: el calculo entero, no un acierto.
 * 2. QUE LA CACHE NO SIRVA DATOS VIEJOS a traves del stack: dos lecturas sin
 *    cambios devuelven el mismo calculo, y una venta en el medio lo invalida.
 * 3. LA PUERTA: 401 sin sesion y 403 para el empleado, con la sesion por cookie
 *    cruzando el proxy.
 */

test.describe("HU-22 — KPIs (API)", () => {
  test("RNF2: la primera carga de un comercio responde en menos de dos segundos", async ({
    api,
  }) => {
    await escenarioDeKpis(api);

    // Calentamiento con OTRA ventana, que es otra clave de la cache: la de 30
    // dias sigue en frio y se calcula entera. Lo que se saca de la medicion es
    // abrir conexiones nuevas a Neon, que desde la maquina de desarrollo cuesta
    // ~1,4 s cada una (TLS + autenticacion a ~200 ms de ida y vuelta) y depende
    // de cuantas tenga abiertas el pool en ese momento, no de esta HU. Un
    // servidor en uso ya las tiene: esas son las "condiciones normales".
    expect((await pedirKpis(api, "?dias=7")).status()).toBe(200);

    const inicio = performance.now();
    const respuesta = await pedirKpis(api);
    const duracion = performance.now() - inicio;

    test.info().annotations.push({
      type: "GET /api/kpis en frío",
      description: `${Math.round(duracion)} ms`,
    });

    expect(respuesta.status()).toBe(200);
    expect(duracion, `GET /api/kpis tardó ${Math.round(duracion)} ms`).toBeLessThan(2000);
  });

  test("sin cambios sale de la caché; una venta la invalida", async ({ api }) => {
    const { yerba } = await escenarioDeKpis(api);

    const primera = await leerKpisViaApi(api);
    const segunda = await leerKpisViaApi(api);

    // Mismo `generadoEn`: es el mismo calculo, servido de la cache.
    expect(segunda.generadoEn).toBe(primera.generadoEn);

    await venderViaApi(api, { productoId: yerba.id, cantidad: 1 });

    const tercera = await leerKpisViaApi(api);
    expect(tercera.generadoEn).not.toBe(primera.generadoEn);
    expect(tercera.rotacion.unidadesVendidas).toBe(
      primera.rotacion.unidadesVendidas + 1,
    );
    expect(tercera.stock.unidades).toBe(primera.stock.unidades - 1);
  });

  test("la ventana pedida se respeta y la que se pasa del máximo se recorta", async ({
    api,
  }) => {
    const siete = await leerKpisViaApi(api, "?dias=7");
    expect(siete.periodo.dias).toBe(7);
    expect(siete.rotacion.porDia).toHaveLength(7);

    const demasiado = await leerKpisViaApi(api, "?dias=365");
    expect(demasiado.periodo.dias).toBe(90);

    const invalido = await pedirKpis(api, "?dias=abc");
    expect(invalido.status()).toBe(400);
  });

  test("sin sesión es 401", async ({ playwright }) => {
    const anonimo = await playwright.request.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    });

    try {
      const respuesta = await anonimo.get("/api/kpis");
      expect(respuesta.status()).toBe(401);
    } finally {
      await anonimo.dispose();
    }
  });

  test("el empleado recibe 403 y el gerente 200", async ({ playwright, api }) => {
    const empleado = await sumarMiembro(playwright, api, { rol: "empleado" });
    const gerente = await sumarMiembro(playwright, api, { rol: "gerente" });

    for (const [persona, esperado] of [
      [empleado, 403],
      [gerente, 200],
    ]) {
      const contexto = await playwright.request.newContext({
        baseURL: BASE_URL,
        storageState: persona.storageState,
      });
      try {
        const respuesta = await contexto.get("/api/kpis");
        expect(respuesta.status(), persona.email).toBe(esperado);
      } finally {
        await contexto.dispose();
      }
    }
  });
});

/**
 * HU-23 — El contrato del periodo de `GET /api/kpis` (SCRUM-35 / SCRUM-145).
 *
 * TODO ESTO VA POR LA API Y NO POR LA UI, Y NO ES UNA ELECCION: desde la
 * pantalla estos pedidos son INALCANZABLES.
 *
 * - El rango al reves y el que se pasa de 366 dias los para el CLIENTE
 *   (`validarPeriodo` del Frontend) y no sale ningun pedido. Por pantalla se ve
 *   `kpis-periodo-rango-invalido`, que es el aviso del cliente, y nunca el 400
 *   del backend. Para comprobar que el backend tampoco confia en el navegador
 *   hay que pegarle directo.
 * - `dias` junto con el rango no se puede armar: `parametrosDePeriodo` devuelve
 *   una forma o la otra.
 * - Un solo extremo tampoco llega: con el rango a medio escribir el cliente no
 *   gasta el viaje.
 * - Una fecha sin zona o mal formada no la puede producir un
 *   `<input type="date">` mas `rango()`.
 *
 * Es el mismo criterio partido que la columna faltante del CSV de HU-7 y el
 * origen igual al destino de HU-12: la pantalla frena, y aca se comprueba que el
 * endpoint igual rechaza para cualquier otro cliente.
 *
 * Lo que NO se repite aca: cada numero del periodo y el corte de los dias en
 * hora de Argentina, que `Backend/tests/kpis.test.js` prueba corriendo fechas en
 * la base.
 */

test.describe("HU-23 — El período de los KPIs (API)", () => {
  test("el rango se respeta con los dos extremos inclusive y periodo.dias los cuenta", async ({
    api,
  }) => {
    const hoy = diaEnArgentina();
    const rango = { desde: sumarDias(hoy, -5), hasta: hoy };

    const cuerpo = await leerKpisViaApi(api, queryDeRango(rango));

    // Del 1 al 1 es 1 dia, no 0: los dos extremos cuentan.
    expect(cuerpo.periodo.dias).toBe(6);
    expect(cuerpo.periodo.zonaHoraria).toBe("America/Argentina/Buenos_Aires");

    // Los extremos vuelven EN UTC CON Z: es el mismo instante que se mando.
    const instantes = rangoDePeriodo(rango.desde, rango.hasta);
    expect(cuerpo.periodo.desde).toBe(new Date(instantes.desde).toISOString());
    expect(cuerpo.periodo.hasta).toBe(new Date(instantes.hasta).toISOString());

    // `porDia` trae EXACTAMENTE `periodo.dias` elementos, del mas viejo al mas
    // nuevo. Es el invariante que sostiene la suma de las barras del grafico.
    expect(cuerpo.rotacion.porDia).toHaveLength(cuerpo.periodo.dias);
    const fechas = cuerpo.rotacion.porDia.map((dia) => dia.fecha);
    expect(fechas).toEqual([...fechas].sort());
    expect(fechas.at(0)).toBe(rango.desde);
    expect(fechas.at(-1)).toBe(rango.hasta);

    // Un dia solo tambien es un periodo valido.
    const unDia = await leerKpisViaApi(api, queryDeRango({ desde: hoy, hasta: hoy }));
    expect(unDia.periodo.dias).toBe(1);
    expect(unDia.rotacion.porDia).toHaveLength(1);

    // Sin montos, siempre y a proposito: el modelo no guarda precios.
    expect(cuerpo.rotacion.montos).toBeNull();
    expect(cuerpo.comprasPorProveedor.montos).toBeNull();

    // Y el stock NO sigue al periodo: viene rotulado para que no se lo lea mal.
    expect(cuerpo.stock.alcance).toBe("actual");
  });

  /**
   * LOS DOS TOPES SE COMPORTAN DISTINTO, y es lo que mas se confunde:
   *
   *   `dias`          se RECORTA en silencio a 90 -> 200
   *   `desde`/`hasta` se RECHAZA arriba de 366    -> 400, no se recorta
   *
   * No se recorta porque para recortarlo habria que mover un extremo, y cual de
   * los dos es adivinar.
   */
  test("el rango de 366 días exactos pasa y el de 367 se rechaza con 400", async ({ api }) => {
    const base = "2026-01-01";

    const exacto = { desde: base, hasta: sumarDias(base, 365) };
    expect(diasEntre(exacto.desde, exacto.hasta), "366 dias exactos").toBe(366);
    const pasa = await leerKpisViaApi(api, queryDeRango(exacto));
    expect(pasa.periodo.dias).toBe(366);

    const unoDeMas = { desde: base, hasta: sumarDias(base, 366) };
    expect(diasEntre(unoDeMas.desde, unoDeMas.hasta)).toBe(367);
    const rechazo = await pedirKpis(api, queryDeRango(unoDeMas));

    expect(rechazo.status(), "367 dias es 400 y NO un 200 recortado").toBe(400);
    expect((await rechazo.json()).error).toContain("no puede abarcar más de 366 días");
  });

  test("las dos formas de pedir el período son excluyentes y un solo extremo es 400", async ({
    api,
  }) => {
    const hoy = diaEnArgentina();
    const { desde, hasta } = rangoDePeriodo(sumarDias(hoy, -5), hoy);

    // `dias` + rango juntos.
    const juntos = await pedirKpis(
      api,
      `?${new URLSearchParams({ dias: "7", desde, hasta })}`,
    );
    expect(juntos.status()).toBe(400);
    expect((await juntos.json()).error).toContain("no se pueden combinar");

    // Un solo extremo, los dos casos. No es "desde siempre hasta marzo": es 400.
    for (const [parametros, falta] of [
      [{ desde }, "hasta"],
      [{ hasta }, "desde"],
    ]) {
      const respuesta = await pedirKpis(api, `?${new URLSearchParams(parametros)}`);
      expect(respuesta.status(), `solo "${Object.keys(parametros)[0]}"`).toBe(400);
      expect((await respuesta.json()).error).toContain(
        `Falta el parámetro "${falta}": el período necesita un rango de fechas`,
      );
    }

    // El rango al reves.
    const alReves = await pedirKpis(
      api,
      `?${new URLSearchParams({ desde: hasta, hasta: desde })}`,
    );
    expect(alReves.status()).toBe(400);
    expect((await alReves.json()).error).toContain(
      'La fecha "desde" no puede ser posterior a la fecha "hasta"',
    );
  });

  /**
   * La zona tiene que ser EXPLICITA. Un "2026-03-01T00:00:00.000" sin offset
   * seria el mismo texto para dos instantes distintos segun quien lo lea, y
   * donde empieza el dia lo decide el cliente.
   */
  test("una fecha sin zona o que no es ISO 8601 es 400", async ({ api }) => {
    const hasta = "2026-03-31T23:59:59.000-03:00";

    for (const desde of [
      "2026-03-01T00:00:00.000", // ISO pero sin zona
      "2026-03-01", // solo el dia
      "01/03/2026", // formato local
      "ayer",
    ]) {
      const respuesta = await pedirKpis(
        api,
        `?${new URLSearchParams({ desde, hasta })}`,
      );
      expect(respuesta.status(), `desde="${desde}"`).toBe(400);
      expect((await respuesta.json()).error, `desde="${desde}"`).toBeTruthy();
    }

    // `Z` tambien es una zona explicita, y se acepta.
    const conZulu = await leerKpisViaApi(
      api,
      `?${new URLSearchParams({ desde: "2026-03-01T03:00:00.000Z", hasta })}`,
    );
    expect(conZulu.periodo.dias).toBe(31);
  });

  /**
   * EL 403 SE EVALUA ANTES QUE EL RANGO. Importa el orden: si se validara
   * primero el periodo, un empleado podria distinguir un rango valido de uno
   * invalido sin tener permiso para leer nada, y de paso recibiria un mensaje
   * que habla del negocio en vez de la puerta cerrada.
   */
  test("al empleado le contesta 403 incluso con un rango que sería 400", async ({
    playwright,
    api,
  }) => {
    const empleado = await sumarMiembro(playwright, api, { rol: "empleado" });
    const contexto = await playwright.request.newContext({
      baseURL: BASE_URL,
      storageState: empleado.storageState,
    });

    try {
      // Un rango de mas de 366 dias, que para el propietario seria 400.
      const query = queryDeRango({ desde: "2026-01-01", hasta: "2027-02-04" });

      const delEmpleado = await contexto.get(`/api/kpis${query}`);
      expect(delEmpleado.status(), "el permiso se evalua primero").toBe(403);
      expect((await delEmpleado.json()).error).toBe(
        "El rol no tiene permiso para esta accion",
      );

      // El contraste por la misma ruta: al propietario si le llega a validar el
      // rango. Sin esto, el 403 podria estar tapando un rechazo por otra causa.
      const delPropietario = await pedirKpis(api, query);
      expect(delPropietario.status()).toBe(400);
    } finally {
      await contexto.dispose();
    }
  });

  /**
   * `comercio_id` sale de la sesion. El param `comercioId` no existe en el
   * contrato: si se manda, se descarta en silencio. Se fija porque un endpoint
   * de indicadores que aceptara un comercio por query seria una fuga entre
   * comercios, y el dia que alguien lo agregue sin pensarlo este test cae.
   */
  test("comercioId no existe: se descarta y cada comercio ve lo suyo", async ({
    api,
    playwright,
  }) => {
    const otro = await crearOtroComercio(playwright);
    try {
      await escenarioDeKpis(otro.api);
      // El otro comercio tiene 3 productos; el del test, ninguno.
      expect((await leerKpisViaApi(otro.api)).stock.productos).toBe(3);
    } finally {
      await otro.api.dispose();
    }

    const hoy = diaEnArgentina();
    const query = queryDeRango({ desde: sumarDias(hoy, -5), hasta: hoy });

    for (const sufijo of ["", "&comercioId=cualquier-cosa", "&comercioId="]) {
      const cuerpo = await leerKpisViaApi(api, `${query}${sufijo}`);
      expect(cuerpo.stock.productos, `comercioId="${sufijo}"`).toBe(0);
      expect(cuerpo.rotacion.ventas, `comercioId="${sufijo}"`).toBe(0);
    }
  });

  /**
   * Los totales de `comprasPorProveedor` son de TODAS las compras del periodo,
   * no solo de los proveedores que entran en la lista visible (hasta 8). Un
   * total que solo sumara los visibles diria menos compras de las que hubo, y es
   * el tipo de error que nadie nota porque el numero parece razonable.
   */
  test("los totales de compras son de todas, no solo de los proveedores visibles", async ({
    api,
  }) => {
    const { esperado } = await escenarioDeKpis(api);
    const hoy = diaEnArgentina();

    const cuerpo = await leerKpisViaApi(
      api,
      queryDeRango({ desde: sumarDias(hoy, -1), hasta: sumarDias(hoy, 1) }),
    );

    expect(cuerpo.comprasPorProveedor).toMatchObject(esperado.compras);
    expect(cuerpo.comprasPorProveedor.proveedores.length).toBeLessThanOrEqual(8);

    // Las tres categorias de stock son excluyentes y suman el total, siempre.
    expect(
      cuerpo.stock.sinStock + cuerpo.stock.bajoUmbral + cuerpo.stock.normal,
    ).toBe(cuerpo.stock.productos);
  });
});
