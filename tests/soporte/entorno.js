import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Datos compartidos de una corrida de E2E.
 *
 * El `global-setup`, cada worker y el `global-teardown` son procesos distintos,
 * asi que el sufijo de la corrida no puede vivir en memoria ni en una variable
 * de entorno: se escribe en un archivo que los tres leen. Sin eso, el teardown
 * calcularia un sufijo propio y no borraria nada.
 */

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost";

/** Misma clave que usan los tests de integracion del Backend. */
export const PASSWORD = "unaClaveSegura123";

/** Rama que tienen que tener Backend y Frontend para que los E2E valgan. */
export const RAMA_ESPERADA = process.env.E2E_RAMA_ESPERADA ?? "dev";

const ARCHIVO_CORRIDA = fileURLToPath(
  new URL("../.e2e-run.json", import.meta.url),
);

/**
 * Genera el sufijo de la corrida y lo deja en disco. Solo lo llama el
 * `global-setup`.
 */
export function crearCorrida() {
  const sufijo = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  writeFileSync(
    ARCHIVO_CORRIDA,
    `${JSON.stringify({ sufijo, iniciada: new Date().toISOString() }, null, 2)}\n`,
  );

  return sufijo;
}

/** Lee el sufijo de la corrida en curso. */
export function leerCorrida() {
  if (!existsSync(ARCHIVO_CORRIDA)) {
    throw new Error(
      `No existe ${ARCHIVO_CORRIDA}. Los tests se corren con "npm run test:e2e", ` +
        "que dispara el global-setup encargado de crearlo.",
    );
  }

  return JSON.parse(readFileSync(ARCHIVO_CORRIDA, "utf8"));
}

export function borrarCorrida() {
  rmSync(ARCHIVO_CORRIDA, { force: true });
}

/**
 * Correo de un comercio de prueba.
 *
 * El prefijo no nombra ninguna HU: los comercios los crea el mismo fixture para
 * todas las suites, y no hay uno por historia. Lo que los identifica es el
 * sufijo de la corrida.
 *
 * Ese sufijo va al final a proposito: el teardown borra con
 * `LIKE '%-<sufijo>@test.local'`, el mismo patron que usa el `afterAll` de
 * Backend/tests/productos.test.js.
 */
export function correoDePrueba(etiqueta, sufijo) {
  return `test-e2e-${etiqueta}-${sufijo}@test.local`;
}

/** Patron SQL de los correos creados por esta corrida. */
export function patronDeCorreo(sufijo) {
  return `%-${sufijo}@test.local`;
}
