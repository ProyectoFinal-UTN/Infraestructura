import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config as cargarEnv } from "dotenv";
import pg from "pg";
import { expect, test as conComercio } from "../../soporte/fixtures.js";

/**
 * Fixture `base` de la suite e2e: escritura directa en Neon para envejecer un
 * producto (HU-27).
 *
 * ESTO NO ES UN ATAJO, ES EL UNICO CAMINO. El analisis de baja rotacion solo
 * mira productos que ya existian cuando empezo la ventana
 * (`lte(producto.createdAt, desde)` en `rotacionDeProductos`), y `desde` es
 * `now - dias` con `dias >= 1` siempre. Del otro lado,
 * `producto.created_at` es `defaultNow()` y `crearProducto` no acepta el campo:
 * no hay query param ni payload que lo mueva. O sea que **ningun producto creado
 * durante la corrida puede ser candidato de rotacion**, con cualquier valor de
 * `RECOMENDACIONES_DIAS`. Sin este UPDATE el escenario `baja_rotacion` no existe
 * y la tarjeta queda sin probar de punta a punta.
 *
 * Lo que se fabrica es la ANTIGUEDAD DEL ALTA y nada mas. El stock, las ventas,
 * el umbral y el analisis entero siguen siendo de verdad, calculados por el
 * backend real sobre Postgres y leidos por la pantalla a traves de Nginx. No se
 * escribe ninguna recomendacion ni ningun saldo: eso si seria falsear el sujeto
 * de la prueba.
 *
 * Mismo patron y mismos motivos que `tests/api/soporte/base.js`:
 *
 * - `DATABASE_URL` sale de ../Backend/.env, el mismo archivo que consume
 *   docker-compose.yml; este repo no tiene `.env` propio.
 * - Se corta si no esta, en vez de avisar: un test que no puede envejecer el
 *   producto no prueba lo que dice, y pasar en verde seria peor que fallar.
 * - El pool es de worker y no de test: dos conexiones para toda la corrida, que
 *   es lo que Neon tolera con `workers: 2` (ver playwright.config.js).
 */

const RUTA_ENV = fileURLToPath(
  new URL("../../../../Backend/.env", import.meta.url),
);

function cadenaDeConexion() {
  if (!existsSync(RUTA_ENV)) {
    throw new Error(
      `No existe ${RUTA_ENV}, asi que no se puede envejecer el producto para ` +
        "probar la baja rotacion (HU-27). Es el mismo archivo que usa " +
        "docker-compose.yml para levantar el backend.",
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
         * Mueve el alta del producto `dias` dias hacia atras.
         *
         * `now()` de Postgres y no una fecha calculada en JS: la comparacion la
         * hace el backend contra el reloj de la base, y restar desde el reloj
         * del runner metia la diferencia entre los dos relojes adentro del
         * margen. Con 45 dias contra una ventana de 30 ese margen sobra, pero el
         * test no tiene por que depender de que sobre.
         *
         * Se afirma que toco exactamente una fila. Un 0 significa que el id no
         * existe o que no es de este comercio, y el sintoma sin esta asercion
         * seria una lista vacia tres pasos mas adelante: "el backend no devolvio
         * la baja rotacion", que apunta al lugar equivocado.
         */
        async envejecerProducto(productoId, dias) {
          const { rowCount } = await pool.query(
            `UPDATE producto
                SET created_at = now() - ($2 || ' days')::interval
              WHERE id = $1`,
            [productoId, dias],
          );

          expect(
            rowCount,
            `No se pudo envejecer el producto ${productoId}: el UPDATE no tocó ninguna fila.`,
          ).toBe(1);
        },
      });

      await pool.end();
    },
    { scope: "worker" },
  ],
});

export { expect };
