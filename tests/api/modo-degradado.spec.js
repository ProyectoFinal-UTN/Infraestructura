import { expect, test } from "../soporte/fixtures.js";
import { crearProductoViaApi } from "../soporte/datos.js";
import { crearOtroComercio } from "../soporte/equipo.js";

/**
 * Contrato del modo degradado (HU-28) contra el stack real, sin navegador.
 *
 * El stack corre sin key del AI Gateway, así que toda consulta pasa por las
 * reglas. Lo que se verifica es lo que la pantalla no muestra: que la
 * respuesta sale de los datos del comercio que pregunta, y de ningún otro.
 */
const RUTA = "/api/asistente/consultas";

test.describe("Modo degradado — POST /api/asistente/consultas", () => {
  test("responde con los productos bajo mínimo del comercio, en modo limitado", async ({
    api,
  }) => {
    const bajo = await crearProductoViaApi(api, {
      umbralMinimo: "5",
      stockActual: "2",
    });

    const respuesta = await api.post(RUTA, {
      data: { pregunta: "¿Qué tengo que reponer?" },
    });

    expect(respuesta.status()).toBe(200);

    const cuerpo = await respuesta.json();
    expect(cuerpo.modo).toBe("limitado");
    expect(cuerpo.respuesta).toContain(bajo.nombre);
    expect(cuerpo.respuesta).toContain("quedan 2 unidades, el mínimo es 5");
  });

  test("no le cuenta a un comercio lo que le falta a otro", async ({
    api,
    playwright,
  }) => {
    // El comercio del test carga un producto bajo mínimo. Otro comercio, recién
    // registrado y vacío, pregunta lo mismo y no tiene que verlo. Es la regla
    // multi-tenant aplicada al modo degradado, que corre sus propias consultas.
    const ajeno = await crearProductoViaApi(api, {
      umbralMinimo: "5",
      stockActual: "0",
    });

    const otro = await crearOtroComercio(playwright);

    try {
      const respuesta = await otro.api.post(RUTA, {
        data: { pregunta: "¿Qué tengo que reponer?" },
      });
      const cuerpo = await respuesta.json();

      expect(cuerpo.respuesta).not.toContain(ajeno.nombre);
      expect(cuerpo.respuesta).toBe(
        "No tenés productos por debajo del stock mínimo.",
      );
    } finally {
      await otro.api.dispose();
    }
  });
});
