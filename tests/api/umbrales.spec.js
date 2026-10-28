import { randomUUID } from "node:crypto";
import { expect, test } from "../soporte/fixtures.js";
import { crearProductoViaApi } from "../soporte/datos.js";
import { sumarMiembro } from "../soporte/equipo.js";
import {
  BASE_URL,
  PASSWORD,
  correoDePrueba,
  leerCorrida,
} from "../soporte/entorno.js";

/**
 * HU-16 — Umbral de reposicion: el contrato de `GET/PUT
 * /api/productos/:id/umbral`, verificado a traves del stack real.
 *
 * La pantalla solo deja mandar enteros (se prueba en
 * tests/e2e/umbrales.spec.js) y no ofrece el formulario a quien no puede
 * usarlo, asi que los rechazos del backend —el 400 a un `"10"` o a un `null`,
 * el 403 del empleado, el 404 de un producto ajeno— no se pueden provocar desde
 * el navegador. Para saber que el backend no confia en la pantalla hay que
 * pegarle directo.
 *
 * `Backend/tests/umbrales.test.js` ya cubre esto en proceso con supertest. Lo
 * que agrega este archivo, igual que `ajustes-mermas.spec.js`, es que la regla
 * sobrevive al stack: Nginx, la sesion por cookie, el contenedor y Neon.
 *
 * En cada rechazo se afirma ademas que el umbral no cambio: un 400 o un 404 que
 * igual hubiera escrito pasaria un test que solo mira el codigo de estado.
 */

const MAXIMO = 2147483647;

const MENSAJE_FALTA = "Falta el umbral mínimo (umbralMinimo)";
const MENSAJE_INVALIDO =
  "El umbral mínimo debe ser un número entero entre 0 y 2147483647";
const MENSAJE_NO_EXISTE = "El producto no existe";

/** Las formas de mandar un umbral que el backend tiene que rechazar. */
const INVALIDOS = [
  { titulo: "sin el campo", cuerpo: {}, mensaje: MENSAJE_FALTA },
  { titulo: "negativo", cuerpo: { umbralMinimo: -1 }, mensaje: MENSAJE_INVALIDO },
  { titulo: "decimal", cuerpo: { umbralMinimo: 2.5 }, mensaje: MENSAJE_INVALIDO },
  // El caso que mas facil se cuela: es lo que entrega un `<input>`.
  { titulo: "número como texto", cuerpo: { umbralMinimo: "10" }, mensaje: MENSAJE_INVALIDO },
  { titulo: "null", cuerpo: { umbralMinimo: null }, mensaje: MENSAJE_INVALIDO },
  {
    titulo: "fuera del integer de Postgres",
    cuerpo: { umbralMinimo: MAXIMO + 1 },
    mensaje: MENSAJE_INVALIDO,
  },
];

function rutaUmbral(productoId) {
  return `/api/productos/${productoId}/umbral`;
}

function leerUmbral(cliente, productoId) {
  return cliente.get(rutaUmbral(productoId));
}

function ponerUmbral(cliente, productoId, cuerpo) {
  return cliente.put(rutaUmbral(productoId), { data: cuerpo });
}

/** El umbral segun el endpoint propio, exigiendo el 200. */
async function umbralDe(api, productoId) {
  const respuesta = await leerUmbral(api, productoId);

  expect(
    respuesta.status(),
    `No se pudo leer el umbral de ${productoId}: ${await respuesta.text()}`,
  ).toBe(200);

  return (await respuesta.json()).umbralMinimo;
}

/** La ficha completa, que es el otro lugar donde se lee el umbral. */
async function leerProducto(api, productoId) {
  const respuesta = await api.get(`/api/productos/${productoId}`);

  expect(
    respuesta.status(),
    `No se pudo leer el producto ${productoId}: ${await respuesta.text()}`,
  ).toBe(200);

  return respuesta.json();
}

/**
 * Un contexto HTTP sin sesion.
 *
 * `storageState` vacio y no omitido: `request.newContext()` hereda el del test,
 * asi que sin esto saldria con la cookie del propietario (ver la nota en
 * `soporte/equipo.js`).
 */
function contextoSinSesion(playwright) {
  return playwright.request.newContext({
    baseURL: BASE_URL,
    storageState: { cookies: [], origins: [] },
  });
}

test.describe("HU-16 — Umbral de reposición (API)", () => {
  test("GET devuelve el umbral con el que se creó el producto", async ({ api }) => {
    const producto = await crearProductoViaApi(api, { umbralMinimo: "5" });

    const respuesta = await leerUmbral(api, producto.id);

    expect(respuesta.status()).toBe(200);
    // `toEqual` y no `toMatchObject`: el endpoint devuelve solo el dato que se
    // configura, no el producto entero.
    expect(await respuesta.json()).toEqual({
      productoId: producto.id,
      umbralMinimo: 5,
    });
  });

  test("PUT cambia el umbral y lo confirman el GET propio y la ficha del producto", async ({
    api,
  }) => {
    const producto = await crearProductoViaApi(api, { umbralMinimo: "5" });

    const respuesta = await ponerUmbral(api, producto.id, { umbralMinimo: 10 });

    expect(respuesta.status(), await respuesta.text()).toBe(200);
    expect(await respuesta.json()).toEqual({
      productoId: producto.id,
      umbralMinimo: 10,
    });

    expect(await umbralDe(api, producto.id)).toBe(10);
    // Es la misma columna que lee el formulario de HU-9 y el analisis de
    // reposicion de HU-27: si la ficha no lo reflejara, habria dos umbrales.
    expect((await leerProducto(api, producto.id)).umbralMinimo).toBe(10);

    // Los dos bordes del rango entran: el maximo del `integer` de Postgres y el
    // 0, que significa "sin umbral".
    for (const valor of [MAXIMO, 0]) {
      const borde = await ponerUmbral(api, producto.id, { umbralMinimo: valor });

      expect(borde.status(), `umbral ${valor}: ${await borde.text()}`).toBe(200);
      expect(await umbralDe(api, producto.id)).toBe(valor);
    }
  });

  test("PUT solo cambia el umbral e ignora cualquier otro campo del body", async ({
    api,
  }) => {
    const producto = await crearProductoViaApi(api, {
      umbralMinimo: "5",
      stockActual: "20",
    });
    const antes = await leerProducto(api, producto.id);

    const respuesta = await ponerUmbral(api, producto.id, {
      umbralMinimo: 8,
      nombre: "Nombre que no se tiene que guardar",
      codigoBarras: "7790000000000",
      categoria: "Otra categoría",
      unidadMedida: "kg",
      stockActual: 999,
    });

    expect(respuesta.status(), await respuesta.text()).toBe(200);
    expect(await respuesta.json()).toEqual({
      productoId: producto.id,
      umbralMinimo: 8,
    });

    const despues = await leerProducto(api, producto.id);

    expect(despues.umbralMinimo).toBe(8);

    // Todo lo demas, igual. `updatedAt` queda afuera a proposito: lo mueve la
    // base en cualquier UPDATE (`$onUpdate`), asi que cambiar es lo correcto.
    for (const campo of [
      "id",
      "nombre",
      "codigoBarras",
      "categoria",
      "unidadMedida",
      "createdAt",
      "stock",
    ]) {
      expect(despues[campo], `cambió «${campo}»`).toEqual(antes[campo]);
    }
    expect(despues.stock.total).toBe(20);
  });

  test("400 ante un umbral ausente o inválido, sin tocar el valor guardado", async ({
    api,
  }) => {
    const producto = await crearProductoViaApi(api, { umbralMinimo: "5" });

    for (const caso of INVALIDOS) {
      const respuesta = await ponerUmbral(api, producto.id, caso.cuerpo);

      expect(respuesta.status(), caso.titulo).toBe(400);
      // El mensaje se afirma para que el 400 sea por el umbral y no por otra
      // cosa que el test no esta mirando.
      expect(await respuesta.json(), caso.titulo).toEqual({
        error: caso.mensaje,
      });
    }

    expect(await umbralDe(api, producto.id)).toBe(5);
  });

  test("401 sin sesión, tanto para leer como para cambiar", async ({
    api,
    playwright,
  }) => {
    const producto = await crearProductoViaApi(api, { umbralMinimo: "5" });
    const anonimo = await contextoSinSesion(playwright);

    try {
      const lectura = await leerUmbral(anonimo, producto.id);
      expect(lectura.status()).toBe(401);
      expect(await lectura.json()).toHaveProperty("error");

      const escritura = await ponerUmbral(anonimo, producto.id, {
        umbralMinimo: 10,
      });
      expect(escritura.status()).toBe(401);
      expect(await escritura.json()).toHaveProperty("error");
    } finally {
      await anonimo.dispose();
    }

    expect(await umbralDe(api, producto.id)).toBe(5);
  });

  test("el empleado puede leer el umbral pero no cambiarlo; el gerente sí", async ({
    api,
    playwright,
  }) => {
    const producto = await crearProductoViaApi(api, { umbralMinimo: "5" });

    const empleado = await sumarMiembro(playwright, api, { rol: "empleado" });
    const gerente = await sumarMiembro(playwright, api, { rol: "gerente" });

    const comoEmpleado = await playwright.request.newContext({
      baseURL: BASE_URL,
      storageState: empleado.storageState,
    });
    const comoGerente = await playwright.request.newContext({
      baseURL: BASE_URL,
      storageState: gerente.storageState,
    });

    try {
      // Lo necesita para saber que reponer, asi que el GET le responde.
      const lectura = await leerUmbral(comoEmpleado, producto.id);
      expect(lectura.status(), await lectura.text()).toBe(200);
      expect((await lectura.json()).umbralMinimo).toBe(5);

      const rechazo = await ponerUmbral(comoEmpleado, producto.id, {
        umbralMinimo: 10,
      });
      expect(rechazo.status()).toBe(403);
      expect(await rechazo.json()).toHaveProperty("error");
      expect(await umbralDe(api, producto.id)).toBe(5);

      // El contraste: el mismo pedido, con el rol que si puede, entra. Sin esto
      // el 403 de arriba podria ser de cualquier cosa.
      const aceptado = await ponerUmbral(comoGerente, producto.id, {
        umbralMinimo: 10,
      });
      expect(aceptado.status(), await aceptado.text()).toBe(200);
      expect(await umbralDe(api, producto.id)).toBe(10);
    } finally {
      await comoEmpleado.dispose();
      await comoGerente.dispose();
    }
  });

  test("404 con un id inexistente o que no es un uuid", async ({ api }) => {
    for (const id of [randomUUID(), "no-es-un-uuid"]) {
      const lectura = await leerUmbral(api, id);
      expect(lectura.status(), `GET ${id}`).toBe(404);
      expect(await lectura.json()).toEqual({ error: MENSAJE_NO_EXISTE });

      // Body valido a proposito: con uno invalido, un id que si existiera
      // daria 400 y el caso no distinguiria nada.
      const escritura = await ponerUmbral(api, id, { umbralMinimo: 10 });
      expect(escritura.status(), `PUT ${id}`).toBe(404);
      expect(await escritura.json()).toEqual({ error: MENSAJE_NO_EXISTE });
    }
  });

  test("404 con un producto dado de baja", async ({ api }) => {
    const producto = await crearProductoViaApi(api, { umbralMinimo: "5" });

    const baja = await api.delete(`/api/productos/${producto.id}`);
    expect(baja.status(), await baja.text()).toBe(204);

    // La baja es logica: la fila sigue en la base con `activo = false`, asi que
    // lo que se prueba es que el endpoint filtra por `activo` y no que el id
    // haya desaparecido.
    const lectura = await leerUmbral(api, producto.id);
    expect(lectura.status()).toBe(404);
    expect(await lectura.json()).toEqual({ error: MENSAJE_NO_EXISTE });

    const escritura = await ponerUmbral(api, producto.id, { umbralMinimo: 10 });
    expect(escritura.status()).toBe(404);
    expect(await escritura.json()).toEqual({ error: MENSAJE_NO_EXISTE });
  });

  test("otro comercio recibe 404 y no puede leer ni cambiar el umbral ajeno", async ({
    api,
    playwright,
  }) => {
    const producto = await crearProductoViaApi(api, { umbralMinimo: "5" });

    // Mismo alta que en `modo-degradado.spec.js`: el sufijo de la corrida va
    // en el correo para que `global-teardown` lo borre con el resto.
    const { sufijo } = leerCorrida();
    const etiqueta = `tenant-${Math.random().toString(16).slice(2, 8)}`;
    const otro = await contextoSinSesion(playwright);

    try {
      const alta = await otro.post("/api/auth/sign-up/email", {
        data: {
          name: `Comercio E2E ${etiqueta}`,
          email: correoDePrueba(etiqueta, sufijo),
          password: PASSWORD,
        },
      });
      expect(alta.status(), await alta.text()).toBe(200);

      // 404 y no 403: un 403 confirmaria que ese id existe en otro comercio.
      const lectura = await leerUmbral(otro, producto.id);
      expect(lectura.status()).toBe(404);
      expect(await lectura.json()).toEqual({ error: MENSAJE_NO_EXISTE });

      const escritura = await ponerUmbral(otro, producto.id, {
        umbralMinimo: 99,
      });
      expect(escritura.status()).toBe(404);
      expect(await escritura.json()).toEqual({ error: MENSAJE_NO_EXISTE });
    } finally {
      await otro.dispose();
    }

    // Lo que importa del aislamiento: el producto del dueno quedo intacto.
    expect(await umbralDe(api, producto.id)).toBe(5);
  });
});
