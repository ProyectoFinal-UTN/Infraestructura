import { expect, test } from "./soporte/base.js";
import {
  crearProductoViaApi,
  enviarMovimiento,
  leerMovimientos,
  leerStock,
  registrarMovimientoViaApi,
  stockEn,
} from "../soporte/datos.js";

/**
 * HU-15 — Ajustes y mermas: el contrato de `POST /api/movimientos` sobre el
 * motivo, verificado a traves del stack real.
 *
 * Va contra la API porque la pantalla nunca deja salir un ajuste o una merma
 * sin motivo (eso se prueba en tests/e2e/ajustes-mermas.spec.js): la unica
 * forma de comprobar que el backend tambien lo frena —y no confia en el
 * navegador— es postear directo.
 *
 * Que se afirma en cada rechazo, ademas del 400: que el mensaje es el del
 * motivo (un 400 por otra causa, como una cantidad invalida, pasaria el test
 * por el motivo equivocado), y que no quedo nada en el libro ni en el saldo,
 * leido directo de la base con el fixture `base`.
 *
 * Backend/tests/ ya cubre la validacion en proceso. Lo que agrega este archivo
 * es que la regla sobrevive al stack: Nginx, el contenedor y Neon.
 *
 * Los productos arrancan en 0 y reciben una compra de 10 antes de cada
 * escenario, igual que en atomicidad-movimientos.spec.js: con stock disponible,
 * un ajuste de salida rechazado solo puede ser por el motivo y nunca por un
 * 409 de stock insuficiente.
 */

/** Las formas de no mandar un motivo que el backend tiene que rechazar. */
const SIN_MOTIVO = [
  { titulo: "sin el campo", cuerpo: {} },
  { titulo: "vacío", cuerpo: { motivo: "" } },
  { titulo: "solo espacios", cuerpo: { motivo: "   " } },
];

/** Los dos tipos que exigen motivo, con lo que cada uno necesita para ir. */
const TIPOS_CON_MOTIVO = [
  { tipo: "merma", articulo: "una" },
  { tipo: "ajuste", articulo: "un", sentido: "salida" },
];

/** Un producto con 10 unidades en «Principal» y un solo movimiento de compra. */
async function productoConStock(api) {
  const producto = await crearProductoViaApi(api, { stockActual: "0" });

  await registrarMovimientoViaApi(api, {
    productoId: producto.id,
    tipo: "compra",
    cantidad: 10,
  });

  return producto;
}

test.describe("HU-15 — Motivo obligatorio en ajustes y mermas (API)", () => {
  for (const { tipo, articulo, sentido } of TIPOS_CON_MOTIVO) {
    test(`${articulo} ${tipo} sin motivo responde 400 y no deja rastro`, async ({
      api,
      base,
    }) => {
      const producto = await productoConStock(api);

      const movimientosAntes = await base.movimientosDe(producto.id);
      const saldosAntes = await base.saldosDe(producto.id);
      expect(movimientosAntes).toHaveLength(1);

      for (const caso of SIN_MOTIVO) {
        const respuesta = await enviarMovimiento(api, {
          productoId: producto.id,
          tipo,
          cantidad: 2,
          ...(sentido ? { sentido } : {}),
          ...caso.cuerpo,
        });

        expect(respuesta.status(), `motivo ${caso.titulo}`).toBe(400);
        expect((await respuesta.json()).error, `motivo ${caso.titulo}`).toBe(
          `Un movimiento de tipo "${tipo}" requiere indicar el motivo`,
        );
      }

      // Ninguno de los tres rechazos inserto una fila ni toco el saldo.
      expect(await base.movimientosDe(producto.id)).toEqual(movimientosAntes);
      expect(await base.saldosDe(producto.id)).toEqual(saldosAntes);

      // El reverso, que es lo que le da sentido a lo de arriba: con motivo el
      // mismo pedido entra. Si el 400 fuera por otra cosa, aca tambien fallaria.
      const aceptada = await enviarMovimiento(api, {
        productoId: producto.id,
        tipo,
        cantidad: 2,
        ...(sentido ? { sentido } : {}),
        motivo: "Conteo de inventario",
      });

      expect(aceptada.status(), await aceptada.text()).toBe(201);
      expect(stockEn(await leerStock(api, producto.id), "Principal")).toBe(8);
    });
  }

  test("el motivo admite hasta 255 caracteres y se guarda recortado", async ({
    api,
    base,
  }) => {
    const producto = await productoConStock(api);
    const movimientosAntes = await base.movimientosDe(producto.id);

    // 256 se rechaza: es el `varchar(255)` de `movimiento.motivo`, y el backend
    // lo frena con un mensaje propio en vez de dejar que reviente la base.
    const largo = await enviarMovimiento(api, {
      productoId: producto.id,
      tipo: "merma",
      cantidad: 1,
      motivo: "x".repeat(256),
    });

    expect(largo.status()).toBe(400);
    expect((await largo.json()).error).toBe(
      "El motivo no puede superar los 255 caracteres",
    );
    expect(await base.movimientosDe(producto.id)).toEqual(movimientosAntes);

    // 255 justos entra: es el borde que si tiene que pasar.
    const justo = "x".repeat(255);
    await registrarMovimientoViaApi(api, {
      productoId: producto.id,
      tipo: "merma",
      cantidad: 1,
      motivo: justo,
    });

    // Los espacios de los bordes no son parte del motivo: se guarda sin ellos.
    await registrarMovimientoViaApi(api, {
      productoId: producto.id,
      tipo: "ajuste",
      sentido: "entrada",
      cantidad: 1,
      motivo: "   Conteo de inventario   ",
    });

    // El historial devuelve del mas reciente al mas antiguo.
    const [ajuste, merma] = await leerMovimientos(api, producto.id);

    expect(ajuste).toMatchObject({
      tipo: "ajuste",
      cantidad: 1,
      motivo: "Conteo de inventario",
    });
    expect(merma).toMatchObject({ tipo: "merma", cantidad: -1, motivo: justo });
  });

  test("en compras y ventas el motivo sigue siendo opcional", async ({ api }) => {
    const producto = await productoConStock(api);

    // La compra de `productoConStock` ya entro sin motivo; se suma una venta
    // para cubrir el otro tipo comercial.
    await registrarMovimientoViaApi(api, {
      productoId: producto.id,
      tipo: "venta",
      cantidad: 3,
    });

    const movimientos = await leerMovimientos(api, producto.id);

    expect(movimientos.map(({ tipo, motivo }) => ({ tipo, motivo }))).toEqual([
      { tipo: "venta", motivo: null },
      { tipo: "compra", motivo: null },
    ]);
    expect(stockEn(await leerStock(api, producto.id), "Principal")).toBe(7);
  });
});
