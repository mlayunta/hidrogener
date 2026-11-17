"use strict";

/*
 * Identificador de la publicación y de su caché.
 * No representa una validación del modelo de cálculo.
 *
 * Cambiar cuando se modifique cualquier archivo de FILES.
 */
const RELEASE = "recursos-fix-2026-11-17-02";

const BASE = new URL(self.registration.scope);

const PREFIX =
  "h2verde-consolidado:" +
  encodeURIComponent(BASE.pathname) +
  ":";

const CACHE_NAME = PREFIX + RELEASE;

/*
 * Todos estos archivos deben existir dentro del alcance
 * del service worker.
 *
 * No añadir aquí archivos particulares de estudios.
 */
const FILES = [
  "index.html",
  "h2professional.js",
  "manifest.json",
  "icon.svg",
  "h2recursos.html"
];

const URLS = FILES.map(file => new URL(file, BASE).href);
const ALLOWED = new Set(URLS);

const INDEX = new URL("index.html", BASE).href;
const RESOURCES = new URL("h2recursos.html", BASE).href;

/*
 * Rutas de navegación y documento correspondiente.
 * Los parámetros de consulta no modifican el HTML servido.
 */
const NAVIGATION_DOCUMENTS = new Map([
  [BASE.pathname, INDEX],
  [new URL(INDEX).pathname, INDEX],
  [new URL(RESOURCES).pathname, RESOURCES]
]);

function unavailable() {
  return new Response(
    "No se encuentra el archivo en la caché de esta publicación. " +
    "Recupere la conexión, cierre todas las ventanas de H₂ Verde " +
    "y vuelva a abrir la aplicación.",
    {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}

async function cachedResponse(url) {
  const cache = await caches.open(CACHE_NAME);
  return (await cache.match(url)) || unavailable();
}

/*
 * Instalación:
 * descarga todos los archivos de la publicación.
 *
 * Si falla un archivo, se elimina la nueva caché incompleta
 * y se rechaza la instalación.
 */
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    try {
      for (const url of URLS) {
        const response = await fetch(url, {
          cache: "reload",
          credentials: "same-origin",
          redirect: "error"
        });

        if (!response.ok || response.type === "opaque") {
          throw new Error(
            "No se pudo descargar " + url +
            " · HTTP " + response.status
          );
        }

        const type = (
          response.headers.get("Content-Type") || ""
        ).toLowerCase();

        const path = new URL(url).pathname;

        /*
         * Evita guardar una página HTML de error como
         * JavaScript, manifiesto o icono.
         */
        if (
          !path.endsWith(".html") &&
          type.includes("text/html")
        ) {
          throw new Error(
            "El servidor devolvió HTML para " + url
          );
        }

        await cache.put(url, response);
      }

      for (const url of URLS) {
        if (!(await cache.match(url))) {
          throw new Error(
            "Publicación incompleta: falta " + url
          );
        }
      }
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }

    /*
     * No se utiliza skipWaiting().
     * La nueva publicación espera a que dejen de utilizarse
     * las páginas controladas por la anterior.
     */
  })());
});

/*
 * Activación:
 * elimina únicamente cachés anteriores que tengan
 * el prefijo de esta aplicación y este alcance.
 */
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    await Promise.all(
      keys
        .filter(key =>
          key.startsWith(PREFIX) &&
          key !== CACHE_NAME
        )
        .map(key => caches.delete(key))
    );

    /*
     * No se utiliza clients.claim().
     * Se evita tomar el control inmediato de páginas
     * que se hayan cargado sin este service worker.
     */
  })());
});

/*
 * Peticiones:
 * sirve desde caché los documentos y archivos declarados.
 *
 * El resto continúa por la vía normal del navegador.
 * No se interceptan solicitudes a PVGIS ni a otros dominios.
 */
self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== BASE.origin) return;

  if (request.mode === "navigate") {
    const documentURL = NAVIGATION_DOCUMENTS.get(
      url.pathname
    );

    if (documentURL) {
      event.respondWith(cachedResponse(documentURL));
      return;
    }
  }

  if (ALLOWED.has(url.href)) {
    event.respondWith(cachedResponse(url.href));
  }
});
