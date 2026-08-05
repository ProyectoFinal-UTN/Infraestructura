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

## Estructura

```
nginx/
├── Dockerfile       # empaqueta Nginx con la config de este repo
└── nginx.conf       # reglas de enrutamiento (/ , /api/, /api-docs/)
tests/               # tests de integración/e2e (pendiente, ver más abajo)
docker-compose.yml   # orquesta nginx + frontend + backend
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