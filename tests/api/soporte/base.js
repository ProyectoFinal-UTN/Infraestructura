import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config as cargarEnv } from "dotenv";
import pg from "pg";
import { expect, test as conComercio } from "../../soporte/fixtures.js";

/**
 * Fixture `base`: lectura directa de Neon para los tests de atomicidad.
 *
 * Hace falta porque lo que hay que observar —que un rechazo no dejo una fila de
 * `movimiento` insertada— no se ve por ninguna API: el libro no tiene endpoint
 * de lectura hasta HU-14, y `GET /api/productos/:id` solo devuelve el saldo
 * cacheado. Sin mirar la tabla, un test podria dar verde con el movimiento
 * grabado y el stock sin actualizar, que es exactamente la falla que busca.
 *
 * `DATABASE_URL` sale de ../Backend/.env, el mismo archivo que consume
 * docker-compose.yml: este repo no tiene `.env` propio. A diferencia del
 * `global-teardown`, que solo avisa si no lo encuentra, aca se corta: una
 * limpieza que no corre deja basura, pero un test que no puede leer la base no
 * prueba nada y no puede pasar en silencio.
 *
 * El pool es de worker y no de test: son dos conexiones para toda la corrida en
 * vez de una por test, que es lo que Neon tolera bien (ver el comentario de
 * `workers` en playwright.config.js).
 */

const RUTA_ENV = fileURLToPath(
  new URL("../../../../Backend/.env", import.meta.url),
);

function cadenaDeConexion() {
  if (!existsSync(RUTA_ENV)) {
    throw new Error(
      `No existe ${RUTA_ENV}, asi que no se puede leer la base para verificar ` +
        "la atomicidad. Es el mismo archivo que usa docker-compose.yml para " +
        "levantar el backend.",
    );
  }

  cargarEnv({ path: RUTA_ENV });

  if (!process.env.DATABASE_URL) {
    throw new Error(`${RUTA_ENV} no define DATABASE_URL.`);
  }

  return process.env.DATABASE_URL;
}

export const test = conComercio.extend({
  base: [
    // El `{}` vacio no es un descuido: Playwright lee la firma para saber de
    // que otros fixtures depende este, y esta no depende de ninguno.
    async ({}, use) => {
      const pool = new pg.Pool({ connectionString: cadenaDeConexion() });

      await use({
        /**
         * Las filas del libro para ese producto, en orden de insercion.
         *
         * Se devuelven solo los campos que el test compara: `fecha` cambia en
         * cada corrida y `id` es aleatorio, asi que incluirlos obligaria a
         * escribir la asercion con matchers laxos en vez de un `toEqual`.
         */
        async movimientosDe(productoId) {
          const { rows } = await pool.query(
            `SELECT tipo, cantidad, ubicacion_id
               FROM movimiento
              WHERE producto_id = $1
              ORDER BY fecha, cantidad`,
            [productoId],
          );

          return rows;
        },

        /** El saldo cacheado por ubicacion, que es lo que la app lee. */
        async saldosDe(productoId) {
          const { rows } = await pool.query(
            `SELECT ubicacion_id, cantidad
               FROM stock
              WHERE producto_id = $1
              ORDER BY ubicacion_id`,
            [productoId],
          );

          return rows;
        },

        /**
         * El saldo recalculado desde el libro, por ubicacion.
         *
         * Es el otro lado del invariante del modelo hibrido:
         * `STOCK.cantidad = SUM(MOVIMIENTO.cantidad)` para cada par
         * (producto, ubicacion).
         */
        async sumasDelLibro(productoId) {
          const { rows } = await pool.query(
            `SELECT ubicacion_id, SUM(cantidad)::int AS cantidad
               FROM movimiento
              WHERE producto_id = $1
              GROUP BY ubicacion_id
              ORDER BY ubicacion_id`,
            [productoId],
          );

          return rows;
        },
      });

      await pool.end();
    },
    { scope: "worker" },
  ],
});

export { expect };
