import { expect } from "@playwright/test";
import { crearProductoViaApi, crearProveedorViaApi } from "./datos.js";
import { comprarViaApi, venderViaApi } from "./alertas.js";
import { crearCompraViaApi } from "./comprasProveedor.js";

/**
 * Andamiaje de HU-22 — KPIs principales del dashboard (`GET /api/kpis`).
 *
 * Todo se arma por los caminos reales (altas de HU-9, movimientos de HU-13,
 * proveedores de HU-19): no se inserta ninguna fila a mano. Asi el escenario
 * atraviesa la misma transaccion que mantiene `stock` y la misma huella con la
 * que el backend invalida su cache de KPIs.
 */

/** `GET /api/kpis` crudo, sin afirmar nada. */
export function pedirKpis(api, query = "") {
  return api.get(`/api/kpis${query}`);
}

/** Los KPIs como andamiaje: exige el 200 y devuelve el cuerpo. */
export async function leerKpisViaApi(api, query = "") {
  const respuesta = await pedirKpis(api, query);

  expect(
    respuesta.status(),
    `No se pudieron leer los KPIs: ${await respuesta.text()}`,
  ).toBe(200);

  return respuesta.json();
}

/**
 * Un comercio chico con un libro conocido, donde cada numero del dashboard se
 * calcula a mano. Los numeros no son redondos a proposito: un total que sumara
 * de mas o de menos no puede dar igual por casualidad.
 *
 *   producto  umbral  movimientos                              saldo
 *   Yerba     5       alta +30, compra a X +10, ventas -5 -2   33  normal
 *   Fideos    10      alta +4, compra sin proveedor +3         7   en o bajo el minimo
 *   Arroz     0       alta +2, venta -2                        0   sin stock
 *
 *   stock:    3 productos, 40 unidades, 1 sin stock, 1 bajo, 1 normal
 *   rotacion: 3 ventas, 9 unidades; Yerba 7, Arroz 2
 *   compras:  2 compras, 13 unidades; X 1/10, sin proveedor 1/3
 *
 * Todos los productos se crean ahora, asi que ninguno cuenta como "sin ventas":
 * ese indicador solo mira los que ya existian al empezar la ventana.
 */
export async function escenarioDeKpis(api) {
  const sufijo = Date.now() % 100000;

  const proveedor = await crearProveedorViaApi(api);

  const yerba = await crearProductoViaApi(api, {
    nombre: `Yerba HU22 ${sufijo}`,
    umbralMinimo: "5",
    stockActual: "30",
  });
  const fideos = await crearProductoViaApi(api, {
    nombre: `Fideos HU22 ${sufijo}`,
    umbralMinimo: "10",
    stockActual: "4",
  });
  const arroz = await crearProductoViaApi(api, {
    nombre: `Arroz HU22 ${sufijo}`,
    umbralMinimo: "0",
    stockActual: "2",
  });

  await crearCompraViaApi(api, {
    productoId: yerba.id,
    proveedorId: proveedor.id,
    cantidad: 10,
  });
  await comprarViaApi(api, { productoId: fideos.id, cantidad: 3 });

  await venderViaApi(api, { productoId: yerba.id, cantidad: 5 });
  await venderViaApi(api, { productoId: yerba.id, cantidad: 2 });
  await venderViaApi(api, { productoId: arroz.id, cantidad: 2 });

  return {
    proveedor,
    yerba,
    fideos,
    arroz,
    esperado: {
      stock: {
        productos: 3,
        unidades: 40,
        sinStock: 1,
        bajoUmbral: 1,
        normal: 1,
        productosSinVentas: 0,
      },
      rotacion: { ventas: 3, unidadesVendidas: 9 },
      compras: { compras: 2, unidades: 13, proveedoresConCompras: 1 },
    },
  };
}
