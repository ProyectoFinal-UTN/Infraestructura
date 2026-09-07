import { expect } from "@playwright/test";

/**
 * Generadores de datos de prueba para el catalogo de productos.
 *
 * Los campos viajan como strings porque asi se cargan en el formulario (un
 * `<input type="number">` entrega string). `crearProductoViaApi` los convierte
 * a numeros antes de postear: el backend chequea `typeof valor === "number"` y
 * rechaza los strings con un 400.
 */

let contador = 0;

/**
 * Codigo de barras unico. El indice unique del backend es
 * `(comercio_id, codigo_barras)` entre productos activos, y cada worker tiene
 * su propio comercio, pero igual se generan distintos para que un test pueda
 * crear varios productos sin chocar.
 */
export function codigoBarras() {
  contador += 1;
  return `7${`${Date.now()}${contador}`.slice(-12)}`;
}

/** Un producto valido, con nombre unico para poder ubicarlo en el listado. */
export function productoValido(overrides = {}) {
  const codigo = overrides.codigoBarras ?? codigoBarras();

  return {
    codigoBarras: codigo,
    nombre: `Coca-Cola 500ml ${codigo.slice(-5)}`,
    categoria: "Bebidas",
    unidadMedida: "unidad",
    umbralMinimo: "5",
    stockActual: "20",
    ...overrides,
  };
}

/**
 * Da de alta un producto por la API, sin pasar por la UI.
 *
 * Es andamiaje: los tests de edicion y de baja necesitan un producto que ya
 * exista, y hacerlos depender del test de alta los encadenaria. La API se usa
 * para armar el escenario, nunca como sujeto del test — eso ya lo cubre
 * Backend/tests/productos.test.js.
 */
export async function crearProductoViaApi(api, overrides = {}) {
  const campos = productoValido(overrides);

  const respuesta = await api.post("/api/productos", {
    data: {
      codigoBarras: campos.codigoBarras,
      nombre: campos.nombre,
      categoria: campos.categoria,
      unidadMedida: campos.unidadMedida,
      umbralMinimo: Number(campos.umbralMinimo),
      stockActual: Number(campos.stockActual),
    },
  });

  expect(
    respuesta.status(),
    `No se pudo precargar el producto: ${await respuesta.text()}`,
  ).toBe(201);

  // Se devuelven los campos como los espera el formulario (strings) mas el
  // `id` que asigno el backend.
  return { ...campos, id: (await respuesta.json()).id };
}
