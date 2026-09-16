import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BASE_URL, RAMA_ESPERADA, crearCorrida } from "./soporte/entorno.js";

/**
 * Chequeos previos a la corrida de tests.
 *
 * 1. Que Backend y Frontend esten en `dev`. No es un detalle formal:
 *    `docker-compose.yml` construye con `context: ../Backend` y `../Frontend`,
 *    o sea que la imagen sale de lo que este checkouteado en la carpeta
 *    hermana. No hay submodules ni tags de imagen, asi que el checkout es lo
 *    unico que define contra que codigo se testea, y una feature branch
 *    olvidada daria una corrida verde que no prueba lo que dice probar.
 * 2. Que el stack responda. `depends_on` no espera a que el backend este sano
 *    (limitacion conocida, documentada en el README), asi que sin este polling
 *    la primera corrida despues de un `up` falla con timeouts cripticos.
 * 3. Dejar en disco el sufijo de la corrida, para el teardown.
 */

const REPOS = {
  Backend: fileURLToPath(new URL("../../Backend", import.meta.url)),
  Frontend: fileURLToPath(new URL("../../Frontend", import.meta.url)),
  Infraestructura: fileURLToPath(new URL("..", import.meta.url)),
};

function git(ruta, ...argumentos) {
  return execFileSync("git", ["-C", ruta, ...argumentos], {
    encoding: "utf8",
  }).trim();
}

function verificarRamas() {
  const desviadas = [];

  for (const [nombre, ruta] of Object.entries(REPOS)) {
    let rama;
    let sha;

    try {
      rama = git(ruta, "rev-parse", "--abbrev-ref", "HEAD");
      sha = git(ruta, "rev-parse", "--short", "HEAD");
    } catch (fallo) {
      throw new Error(
        `No se pudo leer el estado de git de ${nombre} (${ruta}). ` +
          "Los tres repos tienen que estar clonados como carpetas hermanas. " +
          `Detalle: ${fallo.message}`,
      );
    }

    console.log(`  ${nombre.padEnd(16)} ${rama} @ ${sha}`);

    // Infraestructura corre desde su propia branch de trabajo; las que tienen
    // que estar en `dev` son las que aportan el codigo bajo prueba.
    if (nombre !== "Infraestructura" && rama !== RAMA_ESPERADA) {
      desviadas.push(`${nombre} esta en "${rama}"`);
    }
  }

  if (desviadas.length > 0) {
    throw new Error(
      `Los tests corren contra "${RAMA_ESPERADA}", pero ${desviadas.join(" y ")}.\n` +
        `Pone los repos en ${RAMA_ESPERADA} y reconstrui el stack:\n` +
        `  git -C ../Backend checkout ${RAMA_ESPERADA} && git -C ../Backend pull origin ${RAMA_ESPERADA}\n` +
        `  git -C ../Frontend checkout ${RAMA_ESPERADA} && git -C ../Frontend pull origin ${RAMA_ESPERADA}\n` +
        "  docker compose up --build",
    );
  }
}

async function esperarAlStack() {
  const limite = Date.now() + 60_000;
  let ultimoFallo = "sin respuesta";

  while (Date.now() < limite) {
    try {
      const respuesta = await fetch(`${BASE_URL}/health`);

      if (respuesta.ok) {
        const cuerpo = await respuesta.json();
        if (cuerpo?.status === "ok") return;
        ultimoFallo = `/health respondio ${JSON.stringify(cuerpo)}`;
      } else {
        ultimoFallo = `/health respondio ${respuesta.status}`;
      }
    } catch (fallo) {
      ultimoFallo = fallo.message;
    }

    await new Promise((seguir) => setTimeout(seguir, 2000));
  }

  throw new Error(
    `El stack no responde en ${BASE_URL}/health despues de 60s (${ultimoFallo}).\n` +
      "Levantalo desde la raiz de este repo con:\n" +
      "  docker compose up --build\n" +
      "y confirma que exista ../Backend/.env con DATABASE_URL.",
  );
}

export default async function globalSetup() {
  console.log("\nEstado de los repos:");
  verificarRamas();

  console.log(`\nEsperando al stack en ${BASE_URL} …`);
  await esperarAlStack();

  const sufijo = crearCorrida();
  console.log(`Stack listo. Sufijo de esta corrida: ${sufijo}\n`);
}
