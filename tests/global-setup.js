import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BASE_URL, RAMA_ESPERADA, crearCorrida } from "./soporte/entorno.js";

/**
 * Chequeos previos a la corrida de tests.
 *
 * 1. Que Backend y Frontend esten en `dev` Y AL DIA. No es un detalle formal:
 *    `docker-compose.yml` construye con `context: ../Backend` y `../Frontend`,
 *    o sea que la imagen sale de lo que este checkouteado en la carpeta
 *    hermana. No hay submodules ni tags de imagen, asi que el checkout es lo
 *    unico que define contra que codigo se testea, y una feature branch
 *    olvidada daria una corrida verde que no prueba lo que dice probar.
 *
 *    Estar en la rama correcta no alcanza: un repo en `dev` pero atrasado
 *    tambien miente, y mas caro, porque el sintoma no apunta a la causa. Paso
 *    real: con el Backend 6 commits atras de `origin/dev` le faltaba HU-32,
 *    `GET /api/configuracion` contestaba sin el campo `permisos`, el Frontend
 *    entraba en su fail-closed y hasta el propietario veia solo Configuracion.
 *    Visto desde los tests eso parece "los tests de permisos estan mal
 *    escritos", no "falta codigo en la imagen".
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

/**
 * Cuantos commits de `origin/<rama>` le faltan al checkout, o `null` si no se
 * puede saber.
 *
 * A proposito NO hace `git fetch`: compara contra el ref remoto que ya esta en
 * disco. El enlace de la maquina de desarrollo es lento y este setup ya se
 * gasta hasta 60s esperando al stack; sumarle red lo volveria lento y fragil
 * para toda la suite. El precio es que, si hace rato que nadie fetchea, el
 * chequeo no se entera: es un piso, no una garantia.
 *
 * Devuelve `null` —y no 0— cuando el ref remoto no existe (clon sin fetchear,
 * remoto con otro nombre). Son casos en los que no se sabe, y no saber no es lo
 * mismo que estar al dia.
 */
function commitsAtrasados(ruta) {
  try {
    return Number(
      git(ruta, "rev-list", "--count", `HEAD..origin/${RAMA_ESPERADA}`),
    );
  } catch {
    return null;
  }
}

function verificarRamas() {
  const desviadas = [];
  const atrasadas = [];

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

    // Infraestructura corre desde su propia branch de trabajo; las que tienen
    // que estar en `dev` son las que aportan el codigo bajo prueba.
    const aportaCodigo = nombre !== "Infraestructura";

    if (aportaCodigo && rama !== RAMA_ESPERADA) {
      console.log(`  ${nombre.padEnd(16)} ${rama} @ ${sha}`);
      desviadas.push(`${nombre} esta en "${rama}"`);
      continue;
    }

    // Solo tiene sentido preguntar por el atraso de quien ya esta en la rama
    // correcta: si esta en otra, lo que hay que arreglar primero es la rama.
    const atraso = aportaCodigo ? commitsAtrasados(ruta) : null;

    if (atraso === null) {
      console.log(`  ${nombre.padEnd(16)} ${rama} @ ${sha}`);
    } else if (atraso === 0) {
      console.log(`  ${nombre.padEnd(16)} ${rama} @ ${sha} (al dia)`);
    } else {
      console.log(
        `  ${nombre.padEnd(16)} ${rama} @ ${sha} (${atraso} commits atras)`,
      );
      atrasadas.push(
        `${nombre} esta ${atraso} ${atraso === 1 ? "commit" : "commits"} atras`,
      );
    }

    // No corta la corrida: romperle el setup a toda la suite porque falta un
    // ref remoto seria un remedio peor que la enfermedad. Avisa y sigue.
    if (aportaCodigo && atraso === null) {
      console.warn(
        `  [!] No se pudo comparar ${nombre} contra origin/${RAMA_ESPERADA} ` +
          "(falta el ref remoto; probablemente nunca se fetcheo). " +
          "El chequeo de atraso queda sin hacer para este repo.",
      );
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

  if (atrasadas.length > 0) {
    throw new Error(
      `${atrasadas.join(" y ")} respecto de origin/${RAMA_ESPERADA}, asi que el ` +
        "stack se construiria con codigo viejo y la corrida no probaria lo que dice.\n" +
        "Actualizalos y reconstrui el stack:\n" +
        `  git -C ../Backend pull origin ${RAMA_ESPERADA}\n` +
        `  git -C ../Frontend pull origin ${RAMA_ESPERADA}\n` +
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
