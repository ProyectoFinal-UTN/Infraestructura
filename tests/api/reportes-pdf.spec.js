import { randomUUID } from "node:crypto";
import { expect, test } from "../soporte/fixtures.js";
import { BASE_URL } from "../soporte/entorno.js";
import { crearProductoViaApi, crearProveedorViaApi } from "../soporte/datos.js";
import { crearOtroComercio, sumarMiembro } from "../soporte/equipo.js";
import {
  escenarioDeReporte,
  leerPdf,
  nombreDeArchivoEsperado,
  pedirReporte,
  rangoAlrededorDeHoy,
  tieneFormaDePdf,
} from "../soporte/reportes.js";

/**
 * HU-25 — El contrato de `GET /api/reportes/movimientos` contra el stack real
 * (SCRUM-37 / SCRUM-151).
 *
 * `Backend/tests/reportes.test.js` ya recorre el contrato con supertest, en
 * proceso: cada 400 con su mensaje, el tope de 5000 filas, las fechas en otra
 * zona, el aislamiento a nivel query. No se repite esa tabla.
 *
 * Lo que agrega este archivo es lo que supertest no puede ver, porque le pega a
 * Express directo:
 *
 * - Que los HEADERS lleguen intactos a traves de Nginx. El reporte depende de
 *   cuatro: `Content-Type` (que sea un PDF), `Content-Disposition` (el nombre
 *   del archivo), `Cache-Control: no-store` (son datos del comercio) y
 *   `Access-Control-Expose-Headers` (sin el, un Frontend en otro origen no
 *   puede leer el nombre y el PDF baja como "reporte-movimientos.pdf").
 *   `nginx/locations.conf` no los toca hoy; este test es el que avisa el dia
 *   que alguien agregue un `proxy_hide_header` o un `add_header` que los pise.
 * - Que el ROL salga de la cookie real que emitio el alta, y no de un mock del
 *   middleware: gerente entra, empleado no, sin sesion tampoco.
 * - Que el binario cruce el proxy entero (`%PDF-` al principio y `%%EOF` al
 *   final, y que un parser real lo abra).
 */

/** El origen que el compose pone en `TRUSTED_ORIGINS` para el backend. */
const ORIGEN = new URL(BASE_URL).origin;

const MENSAJE_SIN_SESION = "No hay sesion activa";
const MENSAJE_SIN_PERMISO = "El rol no tiene permiso para esta accion";

/**
 * Un contexto HTTP con la sesion de otra persona, o sin ninguna.
 *
 * `storageState` siempre explicito: `request.newContext()` hereda el del test,
 * asi que sin pasarlo saldria con la cookie del propietario (ver la nota en
 * `soporte/equipo.js`).
 */
function contextoCon(playwright, storageState = { cookies: [], origins: [] }) {
  return playwright.request.newContext({ baseURL: BASE_URL, storageState });
}

test.describe("HU-25 — Reporte de movimientos en PDF (API)", () => {
  test("como gerente, los tres tipos devuelven un PDF con el nombre esperado y los headers intactos a través de Nginx", async ({
    api,
    playwright,
  }) => {
    const { comercio, yerba, yerbatera } = await escenarioDeReporte(api);
    const gerente = await sumarMiembro(playwright, api, { rol: "gerente" });
    const comoGerente = await contextoCon(playwright, gerente.storageState);
    const rango = rangoAlrededorDeHoy();

    const casos = [
      { tipo: "periodo", parametros: {}, movimientos: 3 },
      {
        tipo: "producto",
        parametros: { productoId: yerba.id },
        sujeto: yerba.nombre,
        movimientos: 2,
      },
      {
        tipo: "proveedor",
        parametros: { proveedorId: yerbatera.id },
        sujeto: yerbatera.nombre,
        movimientos: 1,
      },
    ];

    try {
      for (const caso of casos) {
        const respuesta = await pedirReporte(
          comoGerente,
          { tipo: caso.tipo, ...rango.api, ...caso.parametros },
          // Con `Origin`, como lo manda un navegador: es lo que hace que el
          // middleware `cors` conteste con sus headers.
          { headers: { Origin: ORIGEN } },
        );

        expect(
          respuesta.status(),
          `${caso.tipo}: ${await respuesta.text()}`,
        ).toBe(200);

        const headers = respuesta.headers();
        const nombre = nombreDeArchivoEsperado({
          tipo: caso.tipo,
          sujeto: caso.sujeto,
          ...rango.dias,
        });

        expect(headers["content-type"], caso.tipo).toMatch(/^application\/pdf/);
        expect(headers["content-disposition"], caso.tipo).toBe(
          `attachment; filename="${nombre}"`,
        );
        expect(headers["cache-control"], caso.tipo).toBe("no-store");
        expect(headers["access-control-expose-headers"], caso.tipo).toContain(
          "Content-Disposition",
        );
        expect(headers["access-control-allow-origin"], caso.tipo).toBe(ORIGEN);

        const cuerpo = await respuesta.body();
        expect(
          tieneFormaDePdf(cuerpo),
          `${caso.tipo}: el cuerpo no tiene forma de PDF (empieza con ` +
            `${JSON.stringify(cuerpo.subarray(0, 8).toString("latin1"))})`,
        ).toBe(true);

        // Que abra con un parser real y diga de quien es y cuantas filas trae.
        // El detalle fila por fila se mira en el e2e, sobre el archivo que
        // descarga el navegador.
        const { texto } = await leerPdf(cuerpo);
        expect(texto, caso.tipo).toContain(comercio);
        expect(texto, caso.tipo).toContain(`Movimientos: ${caso.movimientos}`);
      }
    } finally {
      await comoGerente.dispose();
    }
  });

  test("el empleado recibe 403 y el propietario, por la misma ruta, el PDF", async ({
    api,
    playwright,
  }) => {
    const empleado = await sumarMiembro(playwright, api, { rol: "empleado" });
    const comoEmpleado = await contextoCon(playwright, empleado.storageState);
    const parametros = { tipo: "periodo", ...rangoAlrededorDeHoy().api };

    try {
      const rechazo = await pedirReporte(comoEmpleado, parametros);

      expect(rechazo.status()).toBe(403);
      expect(rechazo.headers()["content-type"]).toMatch(/json/);
      expect(await rechazo.json()).toEqual({ error: MENSAJE_SIN_PERMISO });
    } finally {
      await comoEmpleado.dispose();
    }

    // El contraste: el mismo pedido con el propietario entra. Sin esto el 403
    // de arriba podria venir de cualquier cosa (una ruta mal montada, un
    // parametro de mas).
    const aceptado = await pedirReporte(api, parametros);
    expect(aceptado.status(), await aceptado.text()).toBe(200);
    expect(aceptado.headers()["content-type"]).toMatch(/^application\/pdf/);
  });

  test("401 sin sesión", async ({ playwright }) => {
    const anonimo = await contextoCon(playwright);

    try {
      const respuesta = await pedirReporte(anonimo, {
        tipo: "periodo",
        ...rangoAlrededorDeHoy().api,
      });

      expect(respuesta.status()).toBe(401);
      // El mensaje exacto: el Frontend lo compara tal cual para distinguir
      // sesion vencida de falta de permiso.
      expect(await respuesta.json()).toEqual({ error: MENSAJE_SIN_SESION });
    } finally {
      await anonimo.dispose();
    }
  });

  test("400 con «desde» posterior a «hasta», como JSON y no como PDF", async ({
    api,
  }) => {
    const { desde, hasta } = rangoAlrededorDeHoy().api;

    // Invertidos a proposito.
    const respuesta = await pedirReporte(api, {
      tipo: "periodo",
      desde: hasta,
      hasta: desde,
    });

    expect(respuesta.status()).toBe(400);
    expect(respuesta.headers()["content-type"]).toMatch(/json/);
    expect(await respuesta.json()).toEqual({
      error: 'La fecha "desde" no puede ser posterior a la fecha "hasta"',
    });
  });

  test("404 con un producto o un proveedor de otro comercio, y el dueño sí los reporta", async ({
    api,
    playwright,
  }) => {
    const otro = await crearOtroComercio(playwright);
    const rango = rangoAlrededorDeHoy().api;

    try {
      const productoAjeno = await crearProductoViaApi(otro.api, {
        stockActual: "0",
      });
      const proveedorAjeno = await crearProveedorViaApi(otro.api);

      const casos = [
        {
          parametros: { tipo: "producto", productoId: productoAjeno.id },
          mensaje: "El producto no existe",
        },
        {
          parametros: { tipo: "proveedor", proveedorId: proveedorAjeno.id },
          mensaje: "El proveedor no existe",
        },
      ];

      for (const { parametros, mensaje } of casos) {
        // 404 y no 403: el mismo "no existe" que un id que nunca existio, asi
        // que no se revela que el id es de otro comercio.
        const ajeno = await pedirReporte(api, { ...parametros, ...rango });
        expect(ajeno.status(), parametros.tipo).toBe(404);
        expect(await ajeno.json(), parametros.tipo).toEqual({ error: mensaje });

        // La contraprueba: el mismo id, pedido por su comercio, existe. Sin
        // esto el 404 de arriba pasaria tambien con un id mal armado.
        const propio = await pedirReporte(otro.api, { ...parametros, ...rango });
        expect(propio.status(), `${parametros.tipo}: ${await propio.text()}`).toBe(
          200,
        );
      }

      // Y un uuid que no existe en ningun lado da el mismo 404.
      const inexistente = await pedirReporte(api, {
        tipo: "producto",
        productoId: randomUUID(),
        ...rango,
      });
      expect(inexistente.status()).toBe(404);
      expect(await inexistente.json()).toEqual({ error: "El producto no existe" });
    } finally {
      await otro.api.dispose();
    }
  });
});
