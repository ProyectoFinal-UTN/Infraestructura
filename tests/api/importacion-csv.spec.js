import { expect, test } from "../soporte/fixtures.js";
import { crearProductoViaApi } from "../soporte/datos.js";
import {
  CATALOGO_MIXTO,
  CATALOGO_PUNTO_Y_COMA,
  CATALOGO_SIN_CATEGORIA,
  CATALOGO_VALIDO,
  CODIGO_YA_EN_CATALOGO,
  importarCsv,
  verificarInvariante,
} from "../soporte/csv.js";

/**
 * HU-7 (SCRUM-82) — el contrato de `POST /api/productos/importar`.
 * Lo que la pantalla de importacion no puede alcanzar.
 *
 * Va contra la API y no por la interfaz por una razon concreta: el Frontend
 * valida las columnas obligatorias *antes de subir*
 * (`previa.faltantes` en ImportarProductos.validacion.js), asi que un CSV sin
 * `categoria` nunca llega al backend desde la pantalla. El 400 existe igual y
 * hay que verificarlo, porque es lo que protege al endpoint de cualquier
 * cliente que no sea esa pantalla. El recorrido por interfaz esta en
 * tests/e2e/importacion.spec.js, que ademas cubre el otro lado de este mismo
 * caso: que la pantalla no suba nada.
 *
 * Este archivo corre en el proyecto `api`, sin browser: nada de lo que verifica
 * se ve en una pantalla.
 *
 * Que NO se prueba aca: la lectura del CSV variante por variante (alias de
 * encabezados, comillas sueltas, filas fantasma, columnas ambiguas) ni la
 * validacion de cada campo. Eso ya lo cubren Backend/tests/importacion.test.js
 * y Backend/tests/productosImportacion.service.test.js con supertest, mas
 * rapido y con acceso a la base. Lo que agrega este archivo es que el contrato
 * se sostiene atravesando Nginx y el contenedor real, que es la condicion de la
 * promocion `dev` → `main`.
 */

test.describe("HU-7 — Contrato de la importación de catálogo", () => {
  test.describe("400: lo que invalida el archivo entero", () => {
    test("un CSV sin una columna obligatoria se rechaza entero, no fila por fila", async ({
      api,
    }) => {
      const respuesta = await importarCsv(api, CATALOGO_SIN_CATEGORIA);

      expect(respuesta.status()).toBe(400);

      const cuerpo = await respuesta.json();
      expect(cuerpo).toEqual({ error: CATALOGO_SIN_CATEGORIA.errorDelBackend });

      // El punto del criterio de aceptacion: falta una columna, asi que el
      // archivo esta mal *como archivo*. Devolver 200 con tres errores de fila
      // seria decirle al comerciante que revise sus productos cuando lo que
      // tiene que arreglar es el encabezado. Las tres filas son validas.
      expect(cuerpo.errores).toBeUndefined();
      expect(cuerpo.productos).toBeUndefined();
      expect(cuerpo.totalFilas).toBeUndefined();

      // Y no entro nada: un 400 no importa "las que se podian".
      expect(await (await api.get("/api/productos")).json()).toEqual([]);
    });

    test("un CSV sin filas de datos también se rechaza entero", async ({
      api,
    }) => {
      // Solo saltos de linea: es lo que queda cuando alguien borra el contenido
      // de la planilla pero guarda igual. El archivo de cero bytes no sirve
      // para este caso porque corta antes, en multer, con otro mensaje.
      const respuesta = await importarCsv(api, {
        archivo: "catalogo-vacio.csv",
        contenido: Buffer.from("\n\n\n", "utf8"),
      });

      expect(respuesta.status()).toBe(400);
      expect((await respuesta.json()).error).toBe("El archivo CSV está vacío");
      expect(await (await api.get("/api/productos")).json()).toEqual([]);
    });
  });

  test("el invariante importados + fallidos === procesadas se cumple en todos los 200", async ({
    api,
  }) => {
    // El producto que hace que la fila 6 del mixto choque contra el catalogo.
    await crearProductoViaApi(api, { codigoBarras: CODIGO_YA_EN_CATALOGO });

    // Los tres archivos que devuelven 200, incluido el que trae filas
    // rechazadas: el invariante no depende de que salga todo bien.
    for (const fixture of [
      CATALOGO_VALIDO,
      CATALOGO_MIXTO,
      CATALOGO_PUNTO_Y_COMA,
    ]) {
      const respuesta = await importarCsv(api, fixture);

      expect(
        respuesta.status(),
        `${fixture.archivo}: ${await respuesta.text()}`,
      ).toBe(200);

      const reporte = await respuesta.json();

      verificarInvariante(reporte);
      expect(reporte.totalFilas).toBe(fixture.totalFilas);

      // Ninguno de los tres puede interrumpirse: no hay forma de provocar un
      // corte por HTTP (ver el comentario del final del archivo). Si esto
      // fallara, no seria un test flaky sino la base cayendose de verdad.
      expect(reporte.interrumpido).toBe(false);
    }
  });

  test("volver a subir el mismo archivo no duplica nada y reporta cada fila como repetida", async ({
    api,
  }) => {
    // Es el camino de recuperacion que documenta el endpoint para una
    // importacion interrumpida: "volve a subir el mismo archivo". No hace falta
    // simular el corte para verificar que ese consejo funciona — lo que tiene
    // que cumplirse es que reimportar sea seguro, y eso se prueba entero.
    const primera = await (await importarCsv(api, CATALOGO_VALIDO)).json();

    expect(primera.importados).toBe(CATALOGO_VALIDO.totalFilas);
    expect(primera.fallidos).toBe(0);

    const segunda = await (await importarCsv(api, CATALOGO_VALIDO)).json();

    verificarInvariante(segunda);
    expect(segunda.importados).toBe(0);
    expect(segunda.fallidos).toBe(CATALOGO_VALIDO.totalFilas);

    for (const error of segunda.errores) {
      expect(error.motivo).toBe(
        `Ya existe un producto con el código de barras "${error.codigoBarras}"`,
      );
    }

    // Lo importante: el catalogo quedo con los 5 de la primera pasada, no con
    // 10 ni con 5 pisados.
    const catalogo = await (await api.get("/api/productos")).json();
    expect(catalogo).toHaveLength(CATALOGO_VALIDO.totalFilas);
  });
});

/**
 * Sobre `interrumpido: true`, para que nadie lo lea de menos:
 *
 * Ese estado se activa solo cuando `crearProducto` lanza, a mitad del loop,
 * algo que NO es un `ErrorDeNegocio` de menos de 500 —un bug propio o la base
 * caida— y ademas ya hay al menos una fila commiteada (si no hay ninguna, el
 * service relanza y sale 500). Por HTTP no hay forma de pedir eso: todo lo que
 * un cliente puede mandar deriva en un `ErrorDeNegocio` < 500, que por diseno
 * se anota como fila con error y justamente NO interrumpe. Y la base es Neon,
 * un servicio remoto compartido con los tests del Backend, no un contenedor del
 * docker-compose que se pueda pausar.
 *
 * Falsear la respuesta con un `page.route` probaria que `ResumenImportacion`
 * sabe pintar un JSON inventado, no que el backend produce ese JSON — y eso ya
 * esta cubierto en Frontend/src/components/ResumenImportacion.test.jsx, que es
 * donde corresponde.
 *
 * Lo que si queda verificado del criterio es su consecuencia observable: el
 * invariante se afirma en todos los 200 (incluido el `interrumpido` del helper,
 * por si alguna vez llega uno), y la recuperacion por reintento se prueba de
 * verdad contra el stack en el test de mas arriba.
 */
