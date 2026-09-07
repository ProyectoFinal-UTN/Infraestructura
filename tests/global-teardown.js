import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config as cargarEnv } from "dotenv";
import pg from "pg";
import {
  borrarCorrida,
  leerCorrida,
  patronDeCorreo,
} from "./soporte/entorno.js";

/**
 * Borra de la base todo lo que creo esta corrida.
 *
 * La base es la Neon real y compartida con los tests del Backend: no hay
 * endpoint de reset ni script de seed, asi que la limpieza se hace por SQL,
 * igual que el `afterAll` de Backend/tests/productos.test.js. Solo toca los
 * correos con el sufijo de *esta* corrida, asi que no puede pisar datos de otra
 * corrida en paralelo ni de los tests del Backend.
 *
 * `DATABASE_URL` sale de ../Backend/.env, el mismo archivo que consume
 * docker-compose.yml: este repo no tiene `.env` propio.
 */
export default async function globalTeardown() {
  const rutaEnv = fileURLToPath(new URL("../../Backend/.env", import.meta.url));

  if (!existsSync(rutaEnv)) {
    console.warn(
      `\n[teardown] No existe ${rutaEnv}: no se pudo limpiar la base. ` +
        "Quedaron usuarios y comercios de prueba en Neon.\n",
    );
    return;
  }

  cargarEnv({ path: rutaEnv });

  if (!process.env.DATABASE_URL) {
    console.warn(
      "\n[teardown] ../Backend/.env no define DATABASE_URL: no se pudo limpiar la base.\n",
    );
    return;
  }

  let sufijo;
  try {
    ({ sufijo } = leerCorrida());
  } catch {
    // El setup fallo antes de crear el archivo: no hay nada que borrar.
    return;
  }

  const patron = patronDeCorreo(sufijo);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT m.organization_id
         FROM member m
         JOIN "user" u ON u.id = m.user_id
        WHERE u.email LIKE $1`,
      [patron],
    );

    const organizaciones = rows.map((fila) => fila.organization_id);

    // El orden importa. `comercio` va primero porque `movimiento.usuario_id`
    // es `onDelete: restrict`: borrar antes el usuario falla mientras existan
    // los movimientos que registro (el alta con stock inicial > 0 genera uno).
    // Borrar el comercio se lleva por cascada `producto`, `ubicacion`, `stock`
    // y `movimiento`.
    if (organizaciones.length > 0) {
      await pool.query(
        "DELETE FROM comercio WHERE organization_id = ANY($1::text[])",
        [organizaciones],
      );
    }

    const usuarios = await pool.query('DELETE FROM "user" WHERE email LIKE $1', [
      patron,
    ]);

    if (organizaciones.length > 0) {
      await pool.query("DELETE FROM organization WHERE id = ANY($1::text[])", [
        organizaciones,
      ]);
    }

    console.log(
      `\n[teardown] Limpieza de la corrida ${sufijo}: ` +
        `${usuarios.rowCount} usuario(s) y ${organizaciones.length} comercio(s).\n`,
    );
  } catch (fallo) {
    // No se rompe la corrida por esto: los tests ya dieron su resultado y lo
    // que queda son filas de prueba identificables por el sufijo.
    console.warn(
      `\n[teardown] Falló la limpieza de la corrida ${sufijo}: ${fallo.message}\n` +
        `Se pueden borrar a mano los usuarios con email LIKE '${patron}'.\n`,
    );
  } finally {
    await pool.end();
    borrarCorrida();
  }
}
