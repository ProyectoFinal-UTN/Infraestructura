import { expect, test } from "../soporte/fixtures.js";
import { crearProductoViaApi } from "../soporte/datos.js";
import {
  BASE_URL,
  PASSWORD,
  correoDePrueba,
  leerCorrida,
} from "../soporte/entorno.js";

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

    // El sufijo de la corrida va en el correo para que `global-teardown` lo
    // borre junto con el resto, igual que los comercios del fixture.
    const { sufijo } = leerCorrida();
    const etiqueta = `tenant-${Math.random().toString(16).slice(2, 8)}`;

    // `storageState` vacío: sin esto el contexto hereda la sesión del comercio
    // del test (ver la nota en `soporte/equipo.js`).
    const otro = await playwright.request.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    });

    try {
      const alta = await otro.post("/api/auth/sign-up/email", {
        data: {
          name: `Comercio E2E ${etiqueta}`,
          email: correoDePrueba(etiqueta, sufijo),
          password: PASSWORD,
        },
      });
      expect(alta.status()).toBe(200);

      const respuesta = await otro.post(RUTA, {
        data: { pregunta: "¿Qué tengo que reponer?" },
      });
      const cuerpo = await respuesta.json();

      expect(cuerpo.respuesta).not.toContain(ajeno.nombre);
      expect(cuerpo.respuesta).toBe(
        "No tenés productos por debajo del stock mínimo.",
      );
    } finally {
      await otro.dispose();
    }
  });
});
