# Infraestructura — Centralización y Optimización de la Gestión Comercial

Orquestación del stack completo: Nginx como reverse proxy, Docker Compose levantando Frontend + Backend + Nginx juntos, y (a futuro) tests de integración end-to-end sobre el sistema completo.

## Para qué sirve este repo

Los repos `Frontend` y `Backend` funcionan cada uno de forma independiente en desarrollo (`npm run dev`, sin Docker). Este repo une a los tres en un solo stack local, útil para probar la integración completa y como evidencia de la arquitectura de contenedores. **La producción real no usa este Nginx**: el despliegue final es Backend en Render y Frontend en Vercel, cada uno como servicio independiente con su propio dominio y TLS gestionado por la plataforma (ver Informe de Arquitectura y Despliegue).

**No contiene código de la aplicación** — solo configuración de infraestructura y (eventualmente) tests.

## Requisitos previos

- **Docker Desktop** instalado y corriendo (con backend WSL2 si es Windows).
- Los repos `Frontend`, `Backend` e `Infraestructura` clonados **como carpetas hermanas**, al mismo nivel:

```
Desarrollo/
├── Backend/
├── Frontend/
└── Infraestructura/   ← este repo
```

- Un archivo `.env` real en `Backend/` con `DATABASE_URL` y demás variables completas (ver el README de `Backend`). Este repo **no tiene su propio `.env`** — usa el del backend directamente.

## Levantar el stack completo

Desde la raíz de este repo:

```bash
docker compose up --build
```

- App completa disponible en `http://localhost` (puerto 80)
- `http://localhost/` → sirve el Frontend
- `http://localhost/api/...` → redirige al Backend
- `http://localhost/api-docs/` → redirige al Swagger UI del Backend

Para detener todo:

```bash
docker compose down
```

Para reconstruir un solo servicio después de un cambio (por ejemplo, tras un pull de `Backend`):

```bash
docker compose up --build backend
```

## HTTPS local (para probar la cámara desde el celular — HU-10)

Los navegadores bloquean el acceso a la cámara (`getUserMedia`) fuera de un "contexto seguro": HTTPS, con la única excepción de `http://localhost`. Eso alcanza para probar en la misma PC, pero **no** para un celular real conectándose por la IP de LAN de la PC (ej. `http://192.168.1.23`) — ahí el navegador bloquea la cámara aunque el resto de la app funcione bien.

`docker compose up --build` (sin nada más) sigue funcionando exactamente igual que siempre, solo en HTTP — este paso es **opcional**, hace falta únicamente para probar el escaneo de código de barras en un celular.

1. Instalar `mkcert` una vez por PC (`choco install mkcert` en Windows, `brew install mkcert` en Mac) y correr `mkcert -install` para confiar el CA raíz local.
2. Averiguar la IP de LAN de la PC (`ipconfig` en Windows, `ifconfig`/`ip a` en Mac/Linux — buscar la IP de la red Wi-Fi, ej. `192.168.1.23`).
3. Generar el certificado para esa IP, dentro de este repo:
   ```bash
   mkdir certs
   mkcert -cert-file certs/cert.pem -key-file certs/key.pem <IP-LAN> localhost 127.0.0.1
   ```
   `certs/` está en `.gitignore` — el cert es local a cada developer/red, nunca se commitea.
4. (Opcional pero recomendado) crear un `.env` en este repo con la misma IP, para que Better Auth acepte el origin:
   ```
   HTTPS_LOCAL_ORIGIN=https://<IP-LAN>
   ```
5. Levantar el stack con el override de HTTPS sumado al de siempre:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.https.yml up --build
   ```
6. Confiar el CA raíz de mkcert en el celular — se transfiere el archivo `rootCA.pem` (mkcert indica su ubicación con `mkcert -CAROOT`) por AirDrop/cable/QR y se instala como perfil de confianza. Es un paso único por dispositivo.
7. Desde el celular, en la **misma red Wi-Fi** que la PC, entrar a `https://<IP-LAN>`.

**Alternativa sin instalar nada**, si el proyecto ya tiene Vercel conectado: probar directo contra el preview URL de la PR del Frontend, que ya tiene HTTPS real de Vercel sin configurar nada acá. mkcert queda para cuando hace falta todo el stack local (Backend + Nginx incluidos), no solo el Frontend.

## Estructura

```
nginx/
├── Dockerfile           # empaqueta Nginx con la config de este repo
├── nginx.conf           # config por defecto, HTTP en :80
├── nginx.https.conf     # variante opt-in con HTTPS en :443 (ver arriba)
└── locations.conf       # reglas de enrutamiento (/ , /api/, /api-docs/), compartidas por ambas
tests/                    # tests de integración/e2e (pendiente, ver más abajo)
docker-compose.yml        # orquesta nginx + frontend + backend (uso normal)
docker-compose.https.yml  # override opcional para sumar HTTPS local
```

## Cómo funciona el enrutamiento (Nginx)

| Ruta | Va a | Sirve |
|---|---|---|
| `/` | contenedor `frontend` | Archivos estáticos del build de React |
| `/api/*` | contenedor `backend` | API REST (Express) |
| `/api-docs/*` | contenedor `backend` | Documentación Swagger |

Los contenedores `frontend` y `backend` **no están expuestos directamente** al exterior — solo son alcanzables entre sí dentro de la red interna de Docker Compose. Nginx es el único punto de entrada público.

## Tests de integración (pendiente)

Este repo es donde van a vivir los tests que necesitan **todo el stack levantado** para tener sentido (a diferencia de los tests unitarios, que viven en `Backend`/`Frontend` cada uno por su lado). Se van a agregar cuando se defina el framework (candidato: Playwright, para simular el flujo real de un usuario contra `http://localhost`).

Hasta entonces, `tests/` se mantiene vacía como placeholder de la carpeta.

## Flujo de trabajo con Git

- **`main`**: versión estable, la que se muestra en cada Sprint Review. Protegida — nadie pushea directo.
- **`dev`**: rama de integración del Sprint en curso. También protegida — nadie pushea directo.
- Cada tarea de infraestructura se desarrolla en su propia rama, creada desde `dev`:

```bash
  git checkout dev
  git pull origin dev
  git checkout -b chore/nombre-descriptivo
```

- Al terminar, se abre un Pull Request hacia `dev` (no hacia `main`), asignando a otro integrante como reviewer.
- Este repo tiene un rol particular en la promoción `dev` → `main` de **los tres repos**: es donde la persona a cargo de testing corre los tests de integración sobre el estado combinado de `dev` en Frontend/Backend/Infraestructura antes de aprobar que se promueva a `main`.
- Después de mergear una rama, borrarla.
- Commits descriptivos, no genéricos.

## Troubleshooting

- **`docker compose up --build` falla en el build de `frontend` o `backend`**: confirmar que esos repos ya tienen su propio `Dockerfile` en la raíz, y que están clonados como carpetas hermanas de este repo (no anidadas una dentro de otra).
- **El backend no arranca / no conecta a la base**: confirmar que existe `Backend/.env` con `DATABASE_URL` real. Este repo no crea ese archivo, solo lo referencia.
- **`depends_on` no espera a que el backend esté realmente listo**: es una limitación conocida de Docker Compose — `depends_on` solo espera a que el contenedor arranque, no a que el servicio esté sano. Si aparecen errores intermitentes de conexión al levantar todo por primera vez, reintentar `docker compose up` suele resolverlo; un `healthcheck` es la solución definitiva, pendiente de agregar.
- **Cambios en el código de `Backend` o `Frontend` no se reflejan**: Docker usa la imagen construida en el último build, no el código actual. Correr `docker compose up --build` de nuevo (no solo `docker compose up`) para reconstruir con los cambios.