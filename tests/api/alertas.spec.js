import { expect, test } from "../soporte/fixtures.js";
import { BASE_URL } from "../soporte/entorno.js";
import {
  escenarioDeAlerta,
  leerAlertasViaApi,
  pedirAlertas,
  venderViaApi,
} from "../soporte/alertas.js";

/**
 * HU-17 — Lo del contrato de `GET /api/alertas` que no se puede provocar desde
 * el navegador.
 *
 * Este archivo es chico a proposito. `Backend/tests/` ya cubre la validacion de
 * `pagina` y `limite` caso por caso, y repetir esa tabla aca seria la misma
 * asercion con un stack en el medio. Lo que queda sin cubrir en ningun otro lado
 * son dos cosas, y las dos por el mismo motivo: la UI no tiene como llegar.
 *
 * 1. LA PAGINA QUE NO EXISTE. El panel guarda la pagina en un `useState` y no en
 *    la URL —es deliberado, para no ensuciar la URL del dashboard— y
 *    `pagina-siguiente` esta `disabled` en la ultima, asi que ni escribiendo la
 *    URL a mano se puede pedir una pagina de mas. Igual importa: es un 200 con
 *    la lista vacia y `total > 0`, que es un estado DISTINTO del vacio de verdad
 *    y el Frontend lo dibuja distinto (`alertas-pagina-vacia`, gris y sin
 *    `role="alert"`). Si el backend contestara 404, o un 200 con `total: 0`, la
 *    pantalla diria «no tenes nada que reponer» cuando si hay — la conclusion
 *    opuesta a la verdadera.
 * 2. EL STRING LITERAL DEL 401. El Frontend matchea «No hay sesion activa» tal
 *    cual para distinguir sesion vencida de falta de permiso, y manda a cada una
 *    a un aviso distinto. Es un acoplamiento a un string, y por eso tiene que
 *    haber un test que caiga si alguien le cambia una palabra o le pone una
 *    tilde. Desde una sesion valida no se provoca: hay que pedir sin cookie.
 */

test.describe("HU-17 — Alertas de reposición (API)", () => {
  test("una página más allá del total es un 200 con la lista vacía, no un 404", async ({
    api,
  }) => {
    const { producto } = await escenarioDeAlerta(api, {
      umbral: 5,
      stockInicial: 20,
    });

    await venderViaApi(api, { productoId: producto.id, cantidad: 16 });

    // La precondicion, afirmada: hay una alerta. Sin esto el test pasaria
    // igual con un comercio vacio, y entonces no probaria la pagina fuera de
    // rango sino el vacio.
    const primera = await leerAlertasViaApi(api);
    expect(primera.alertas).toHaveLength(1);
    expect(primera.paginacion.total).toBe(1);

    const respuesta = await pedirAlertas(api, "?pagina=99");

    expect(
      respuesta.status(),
      `pedir una página que no existe no es un error: ${await respuesta.text()}`,
    ).toBe(200);

    const cuerpo = await respuesta.json();

    // Los dos datos juntos son lo que hace que el Frontend pueda distinguir
    // este estado del vacio: lista vacia PERO total mayor que cero.
    expect(cuerpo.alertas).toEqual([]);
    expect(cuerpo.paginacion.total).toBe(1);
    expect(cuerpo.paginacion.pagina).toBe(99);

    // El limite se lee de la respuesta y nunca del valor pedido. Se afirma que
    // viene y que es un numero, no cuanto vale: el default es asunto del
    // backend, y clavar el 50 aca ataria esta suite a una decision que puede
    // cambiar sin romper nada.
    expect(typeof cuerpo.paginacion.limite).toBe("number");
    expect(cuerpo.paginacion.limite).toBeGreaterThan(0);
  });

  test("un límite por encima del máximo se recorta en silencio", async ({
    api,
  }) => {
    const { producto } = await escenarioDeAlerta(api, {
      umbral: 5,
      stockInicial: 20,
    });

    await venderViaApi(api, { productoId: producto.id, cantidad: 16 });

    // 500 esta por arriba del maximo de 200. El contrato dice que recorta y no
    // falla, asi que lo que se verifica es el 200 y el limite EFECTIVO — que es
    // el unico que se puede mostrar o asertar sin mentir.
    const respuesta = await pedirAlertas(api, "?limite=500");

    expect(
      respuesta.status(),
      `un límite de más se recorta, no falla: ${await respuesta.text()}`,
    ).toBe(200);

    const { paginacion } = await respuesta.json();

    expect(
      paginacion.limite,
      "el límite que vuelve tiene que ser el recortado, no el que se pidió",
    ).toBeLessThan(500);
  });

  test("sin sesión contesta el 401 con el mensaje exacto que el Frontend matchea", async ({
    playwright,
  }) => {
    // Contexto con `storageState` vacio y no omitido: `newContext()` HEREDA el
    // del test, asi que sin esto el pedido «sin sesion» saldria con la cookie
    // del comercio y contestaria 200. Es la misma trampa que documenta
    // `sumarMiembro` en `tests/soporte/equipo.js`.
    const anonimo = await playwright.request.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    });

    try {
      const respuesta = await pedirAlertas(anonimo);

      expect(respuesta.status()).toBe(401);

      // `toEqual` sobre el cuerpo entero y no un `toContain`: el Frontend
      // compara este string tal cual para decidir si muestra «se venció tu
      // sesión» o «no tenés permiso». Una tilde de más, una palabra cambiada o
      // un campo extra lo rompen, y el síntoma aparecería lejos — en un aviso
      // equivocado, no en este endpoint.
      expect(await respuesta.json()).toEqual({ error: "No hay sesion activa" });
    } finally {
      await anonimo.dispose();
    }
  });
});
