import { expect, test } from "../soporte/fixtures.js";
import { BASE_URL } from "../soporte/entorno.js";
import { sumarMiembro } from "../soporte/equipo.js";
import { venderViaApi } from "../soporte/alertas.js";
import { escenarioDeKpis, leerKpisViaApi, pedirKpis } from "../soporte/kpis.js";

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
