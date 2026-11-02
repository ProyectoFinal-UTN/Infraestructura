import { randomUUID } from "node:crypto";
import { expect, test } from "../soporte/fixtures.js";
import { pedirHistorial } from "../soporte/comprasProveedor.js";

/**
 * HU-21 — Lo único del contrato del historial de compras que no se puede
 * provocar desde el navegador.
 *
 * Este archivo es chico a propósito. `Backend/tests/` ya cubre los formatos de
 * fecha uno por uno, la combinatoria de filtros y los códigos de error, y
 * repetir esa tabla acá no agregaría nada: sería la misma aserción con más
 * infraestructura en el medio.
 *
 * Lo que sí queda sin cubrir en ningún otro lado es el ORDEN entre dos
 * validaciones, porque es un cruce y no un formato: el filtro se valida ANTES de
 * buscar el proveedor (`validarFiltrosCompras` corre antes de
 * `exigirProveedorDelHistorial` en `comprasProveedor.service.js`). Un id que no
 * existe con una fecha mal formada tiene que dar 400 y no 404.
 *
 * Por qué importa el orden y no es un detalle de implementación: si contestara
 * 404, la pantalla diría "el proveedor no existe" cuando el proveedor está bien
 * y lo que hay que arreglar es la fecha. El usuario se queda mirando el dato
 * equivocado.
 *
 * Y por qué hay que pegarle por API: desde la UI es INALCANZABLE. El service del
 * Frontend normaliza cualquier "AAAA-MM-DD" a ISO con zona y descarta en
 * silencio lo que no tenga esa forma, así que ninguna URL —ni una escrita a
 * mano— llega al backend con una fecha inválida.
 */

/** Una fecha sin zona: el backend exige ISO 8601 CON zona. */
const FECHA_SIN_ZONA = "2026-01-01";

const MENSAJE_FECHA =
  'El parámetro "desde" debe ser una fecha y hora ISO 8601 con zona, por ejemplo 2026-09-18T03:00:00.000Z';
const MENSAJE_NO_EXISTE = "El proveedor no existe";

test.describe("HU-21 — Historial de compras (API)", () => {
  test("el filtro inválido se evalúa antes de buscar el proveedor", async ({
    api,
  }) => {
    const inexistente = randomUUID();

    // Las dos formas de que el proveedor no se pueda encontrar: un uuid que no
    // existe y un id que ni siquiera tiene forma de uuid. En los dos casos manda
    // la fecha.
    for (const id of [inexistente, "no-es-un-uuid"]) {
      const respuesta = await pedirHistorial(api, id, `?desde=${FECHA_SIN_ZONA}`);

      expect(
        respuesta.status(),
        `con id "${id}" y una fecha sin zona tiene que ganar el 400`,
      ).toBe(400);
      expect(await respuesta.json()).toEqual({ error: MENSAJE_FECHA });
    }

    // La contraprueba, y es la que hace que lo de arriba pruebe el ORDEN y no
    // solamente "contesta 400": con el mismo id inexistente y una fecha válida,
    // el 404 sí aparece. Sin esto, un backend que contestara 400 a todo pasaría
    // el test.
    const conFechaValida = await pedirHistorial(
      api,
      inexistente,
      "?desde=2026-01-01T03:00:00.000Z",
    );

    expect(conFechaValida.status()).toBe(404);
    expect(await conFechaValida.json()).toEqual({ error: MENSAJE_NO_EXISTE });
  });
});
