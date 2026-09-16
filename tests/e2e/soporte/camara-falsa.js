import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import bwipjsImport from "bwip-js";
import { PNG } from "pngjs";

/**
 * Genera un video Y4M con un código de barras EAN-13 centrado, para usarlo
 * como "cámara" falsa de Chromium (HU-10).
 *
 * Por qué un video y no mockear `getUserMedia` en JS: `useEscanerCodigoBarras`
 * (ver Frontend/src/hooks) decodifica frames reales que zxing lee de un
 * `<video>` conectado a un `MediaStream` de verdad. Reemplazar la API en el
 * navegador probaría el mock, no que la cámara real → zxing → el resto de la
 * pantalla encajan. Chromium sí soporta una cámara de mentira a nivel de
 * proceso: los flags `--use-fake-device-for-media-stream` y
 * `--use-file-for-fake-video-capture=<archivo.y4m>` hacen que
 * `getUserMedia({video: true})` devuelva un stream real, con frames reales,
 * leídos de este archivo — zxing no puede distinguirlo de una webcam.
 *
 * Y4M (YUV4MPEG2) es el único contenedor que ese flag acepta sin necesitar
 * un decoder de por medio, y es sencillo: una cabecera de texto y frames
 * crudos en YUV 4:2:0. Se arma a mano acá (sin `ffmpeg`, que no es una
 * dependencia de este repo) para no depender de un binario externo que
 * alguien tendría que instalar aparte para poder correr `npm install` y ya.
 */

const bwipjs = bwipjsImport.default ?? bwipjsImport;

// Resolución de una webcam chica, de sobra para que zxing lea un código a
// tamaño de etiqueta sin que el archivo pese demasiado.
const ANCHO = 640;
const ALTO = 480;
// El archivo se reproduce en loop mientras dure el test, así que un solo
// frame repetido alcanza — la "escena" no cambia, es una etiqueta quieta
// frente a la cámara. Van varios de todos modos para no depender de que
// Chromium maneje bien un archivo de un frame único.
const CUADROS = 5;
const FPS = 10;

function calcularDigitoControlEan13(doceDigitos) {
  let suma = 0;
  for (let i = 0; i < 12; i += 1) {
    const digito = Number(doceDigitos[i]);
    suma += i % 2 === 0 ? digito : digito * 3;
  }
  return (10 - (suma % 10)) % 10;
}

/**
 * Un EAN-13 válido (dígito de control correcto), único por corrida. Sin un
 * dígito de control correcto zxing lo descarta como ilegible, igual que lo
 * haría un lector real: no alcanza con que "parezca" un código de barras.
 */
export function generarCodigoEan13() {
  const base = `750${Date.now()}`.slice(0, 12).padEnd(12, "0");
  return `${base}${calcularDigitoControlEan13(base)}`;
}

function clamp(valor) {
  return Math.max(0, Math.min(255, Math.round(valor)));
}

/** BT.601 de rango completo (0-255), la misma convención que `C420jpeg`. */
function rgbAYuv(r, g, b) {
  return [
    0.299 * r + 0.587 * g + 0.114 * b,
    -0.168736 * r - 0.331264 * g + 0.5 * b + 128,
    0.5 * r - 0.418688 * g - 0.081312 * b + 128,
  ];
}

/**
 * El PNG del código, centrado sobre un fondo blanco de `ANCHO`x`ALTO`.
 *
 * bwip-js dibuja sobre fondo **transparente** (alpha 0), no blanco: el RGB de
 * esos píxeles de fondo es (0,0,0) igual que la tinta negra, solo que con
 * alpha en 0. Un visor de imágenes lo compone sobre blanco solo, así que se
 * ve bien — pero copiar el RGB crudo sin mirar el alpha pega un rectángulo
 * negro sólido del tamaño del código entero. Hay que alfa-componer sobre
 * blanco a mano.
 */
function componerFrameRgba(barcodePng) {
  const frame = Buffer.alloc(ANCHO * ALTO * 4, 255);
  const offsetX = Math.floor((ANCHO - barcodePng.width) / 2);
  const offsetY = Math.floor((ALTO - barcodePng.height) / 2);

  for (let y = 0; y < barcodePng.height; y += 1) {
    for (let x = 0; x < barcodePng.width; x += 1) {
      const destinoX = offsetX + x;
      const destinoY = offsetY + y;
      if (destinoX < 0 || destinoX >= ANCHO || destinoY < 0 || destinoY >= ALTO) {
        continue;
      }

      const origen = (y * barcodePng.width + x) * 4;
      const destino = (destinoY * ANCHO + destinoX) * 4;
      const alpha = barcodePng.data[origen + 3] / 255;

      for (let canal = 0; canal < 3; canal += 1) {
        const tinta = barcodePng.data[origen + canal];
        frame[destino + canal] = clamp(tinta * alpha + 255 * (1 - alpha));
      }
      frame[destino + 3] = 255;
    }
  }

  return frame;
}

/** RGBA -> planos Y4M en 4:2:0 (U y V submuestreados en bloques de 2x2). */
function frameRgbaAYuv420(rgba) {
  const yPlane = Buffer.alloc(ANCHO * ALTO);
  const anchoChroma = ANCHO / 2;
  const uPlane = Buffer.alloc(anchoChroma * (ALTO / 2));
  const vPlane = Buffer.alloc(anchoChroma * (ALTO / 2));

  for (let y = 0; y < ALTO; y += 1) {
    for (let x = 0; x < ANCHO; x += 1) {
      const i = (y * ANCHO + x) * 4;
      const [luma] = rgbAYuv(rgba[i], rgba[i + 1], rgba[i + 2]);
      yPlane[y * ANCHO + x] = clamp(luma);
    }
  }

  for (let cy = 0; cy < ALTO / 2; cy += 1) {
    for (let cx = 0; cx < anchoChroma; cx += 1) {
      let sumaU = 0;
      let sumaV = 0;

      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const x = cx * 2 + dx;
          const y = cy * 2 + dy;
          const i = (y * ANCHO + x) * 4;
          const [, u, v] = rgbAYuv(rgba[i], rgba[i + 1], rgba[i + 2]);
          sumaU += u;
          sumaV += v;
        }
      }

      uPlane[cy * anchoChroma + cx] = clamp(sumaU / 4);
      vPlane[cy * anchoChroma + cx] = clamp(sumaV / 4);
    }
  }

  return Buffer.concat([yPlane, uPlane, vPlane]);
}

/**
 * Genera el `.y4m` para `codigoBarras` y devuelve su ruta absoluta.
 *
 * El archivo se escribe en `tests/.tmp/` (gitignored, ver `.gitignore`):
 * es un artefacto reproducible a partir del código, no algo para versionar.
 */
export async function generarVideoCamaraFalsa(codigoBarras) {
  const pngBuffer = await bwipjs.toBuffer({
    bcid: "ean13",
    text: codigoBarras,
    scale: 4,
    height: 20,
    includetext: true,
    textxalign: "center",
  });

  const barcodePng = PNG.sync.read(pngBuffer);
  const frameYuv = frameRgbaAYuv420(componerFrameRgba(barcodePng));

  const cabecera = `YUV4MPEG2 W${ANCHO} H${ALTO} F${FPS}:1 Ip A1:1 C420jpeg\n`;
  const partes = [Buffer.from(cabecera, "ascii")];
  for (let i = 0; i < CUADROS; i += 1) {
    partes.push(Buffer.from("FRAME\n", "ascii"), frameYuv);
  }

  const directorio = fileURLToPath(new URL("../../.tmp", import.meta.url));
  mkdirSync(directorio, { recursive: true });
  const ruta = fileURLToPath(
    new URL(`../../.tmp/camara-${codigoBarras}.y4m`, import.meta.url),
  );
  writeFileSync(ruta, Buffer.concat(partes));

  return ruta;
}
