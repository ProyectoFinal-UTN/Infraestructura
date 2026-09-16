import { expect, test } from "./soporte/base.js";
import {
  crearProductoViaApi,
  crearUbicacionViaApi,
  enviarMovimiento,
  leerStock,
  registrarMovimientoViaApi,
  stockEn,
} from "../soporte/datos.js";

/**
 * HU-13 (SCRUM-25), criterio de rollback — la transaccion no deja el stock a
 * medias. Subtarea de testing SCRUM-94.
 *
 * Va contra la API y no por la interfaz porque lo que hay que observar —que no
 * quedo una fila de `movimiento` insertada sin su actualizacion de stock— no se
 * ve en ninguna pantalla. El navegador no aportaria nada al caso, asi que este
 * archivo corre en el proyecto `api`, sin browser.
 *
 * Alcance, escrito para que nadie lo lea de mas: los dos guardas del backend
 * (stock insuficiente y desborde del `integer`) corren **antes** del INSERT del
 * movimiento, en `aplicarMovimiento`. Por HTTP no hay forma de forzar un fallo
 * *despues* de insertar, asi que lo que se prueba aca no es el `ROLLBACK` de
 * Postgres sino su consecuencia observable: ningun rechazo deja el sistema a
 * medias, y el saldo cacheado nunca se despega del libro.
 *
 * Backend/tests/movimientos.test.js ya prueba lo mismo con supertest en
 * proceso. Lo que agrega este archivo es que la propiedad se sostiene
 * atravesando Nginx y el contenedor real, que es la condicion que pide la
 * promocion `dev → main` (ver references/git-workflow.md). No se re-testea la
 * logica: se verifica que sobrevive al stack.
 *
 * Los productos se crean con `stockActual: 0` a proposito. Un alta con stock
 * inicial mayor a cero genera su propio movimiento de respaldo, y entonces los
 * conteos de filas arrancarian en uno por un motivo que no tiene que ver con lo
 * que el test prueba. Con cero, el alta crea la fila de `stock` y ningun
 * movimiento.
 */

test.describe("HU-13 — Atomicidad del registro de movimiento", () => {
  test("un rechazo por stock insuficiente no deja movimiento ni toca el saldo", async ({
    api,
    base,
  }) => {
    const producto = await crearProductoViaApi(api, { stockActual: "0" });

    await registrarMovimientoViaApi(api, {
      productoId: producto.id,
      tipo: "compra",
      cantidad: 20,
    });

    const movimientosAntes = await base.movimientosDe(producto.id);
    const saldosAntes = await base.saldosDe(producto.id);

    expect(movimientosAntes).toHaveLength(1);
    expect(saldosAntes).toHaveLength(1);
    expect(saldosAntes[0].cantidad).toBe(20);

    const rechazada = await enviarMovimiento(api, {
      productoId: producto.id,
      tipo: "venta",
      cantidad: 999,
    });

    expect(rechazada.status()).toBe(409);
    expect((await rechazada.json()).error).toMatch(/stock insuficiente/i);

    // Ni media fila: el libro quedo igual y el saldo tambien. Si la
    // transaccion se hubiera aplicado por partes, una de las dos consultas
    // devolveria algo distinto.
    expect(await base.movimientosDe(producto.id)).toEqual(movimientosAntes);
    expect(await base.saldosDe(producto.id)).toEqual(saldosAntes);
  });

  test("dos salidas simultáneas de las últimas unidades dejan una sola registrada", async ({
    api,
    base,
  }) => {
    // Es el escenario real de "quedar a medias": las dos leen el mismo saldo,
    // las dos pasan la validacion y las dos descuentan. Lo que lo evita es el
    // `FOR UPDATE` sobre la fila de stock, que serializa la segunda.
    const producto = await crearProductoViaApi(api, { stockActual: "0" });

    await registrarMovimientoViaApi(api, {
      productoId: producto.id,
      tipo: "compra",
      cantidad: 10,
    });

    const [una, otra] = await Promise.all([
      enviarMovimiento(api, {
        productoId: producto.id,
        tipo: "venta",
        cantidad: 10,
      }),
      enviarMovimiento(api, {
        productoId: producto.id,
        tipo: "venta",
        cantidad: 10,
      }),
    ]);

    expect([una.status(), otra.status()].sort()).toEqual([201, 409]);

    const ventas = (await base.movimientosDe(producto.id)).filter(
      (fila) => fila.tipo === "venta",
    );

    expect(ventas).toHaveLength(1);
    expect(ventas[0].cantidad).toBe(-10);

    const saldos = await base.saldosDe(producto.id);
    expect(saldos).toHaveLength(1);
    expect(saldos[0].cantidad).toBe(0);
  });

  test("el saldo cacheado sigue siendo la suma del libro tras una secuencia mixta", async ({
    api,
    base,
  }) => {
    const producto = await crearProductoViaApi(api, { stockActual: "0" });
    const deposito = await crearUbicacionViaApi(api, "Depósito");

    const ubicaciones = await (await api.get("/api/ubicaciones")).json();
    const principal = ubicaciones.find((una) => una.nombre === "Principal");
    expect(principal, "el alta del producto no creó «Principal»").toBeTruthy();

    // Con dos ubicaciones la ubicacion pasa a ser obligatoria, asi que todos
    // los pedidos la llevan. Se alternan aceptados y rechazados sobre las dos:
    // si un rechazo dejara rastro, el invariante de abajo lo delata.
    const SECUENCIA = [
      { ubicacion: principal, tipo: "compra", cantidad: 30, estado: 201 },
      { ubicacion: principal, tipo: "venta", cantidad: 12, estado: 201 },
      { ubicacion: principal, tipo: "venta", cantidad: 999, estado: 409 },
      { ubicacion: deposito, tipo: "venta", cantidad: 1, estado: 409 },
      { ubicacion: deposito, tipo: "compra", cantidad: 5, estado: 201 },
      {
        ubicacion: deposito,
        tipo: "ajuste",
        sentido: "salida",
        cantidad: 2,
        estado: 201,
      },
      {
        ubicacion: deposito,
        tipo: "ajuste",
        sentido: "salida",
        cantidad: 4,
        estado: 409,
      },
      { ubicacion: principal, tipo: "merma", cantidad: 3, estado: 201 },
    ];

    for (const paso of SECUENCIA) {
      const respuesta = await enviarMovimiento(api, {
        productoId: producto.id,
        ubicacionId: paso.ubicacion.id,
        tipo: paso.tipo,
        cantidad: paso.cantidad,
        ...(paso.sentido ? { sentido: paso.sentido } : {}),
      });

      expect(
        respuesta.status(),
        `${paso.tipo} de ${paso.cantidad} en ${paso.ubicacion.nombre}: ${await respuesta.text()}`,
      ).toBe(paso.estado);
    }

    // El invariante del modelo hibrido, verificado contra la base: el saldo
    // cacheado que lee la app y la suma del libro append-only tienen que dar lo
    // mismo en cada ubicacion. Vale el `toEqual` directo porque las dos
    // ubicaciones recibieron al menos un movimiento aceptado.
    expect(await base.saldosDe(producto.id)).toEqual(
      await base.sumasDelLibro(producto.id),
    );

    // Y los numeros concretos, para que el invariante no se cumpla por
    // casualidad estando los dos lados igual de mal: 30 - 12 - 3 en Principal,
    // 5 - 2 en Depósito.
    const detalle = await leerStock(api, producto.id);
    expect(stockEn(detalle, "Principal")).toBe(15);
    expect(stockEn(detalle, deposito.nombre)).toBe(3);
    expect(detalle.total).toBe(18);
  });
});
