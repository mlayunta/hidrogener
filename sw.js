"use strict";

const RELEASE = "profesional-3.1-01";
const BASE = new URL(self.registration.scope);
const PREFIX = "h2verde-consolidado:" +
  encodeURIComponent(BASE.pathname) + ":";
const CACHE_NAME = PREFIX + RELEASE;

const FILES = [
  "index.html",
  "h2professional.js",
  "manifest.json",
  "icon.svg"
];

const URLS = FILES.map(file=>new URL(file,BASE).href);
const ALLOWED = new Set(URLS);
const INDEX = new URL("index.html",BASE).href;
const NAV_PATHS = new Set([BASE.pathname,new URL(INDEX).pathname]);

function unavailable(){
  return new Response(
    "La publicación local está incompleta. Recupere la conexión y reinstale la aplicación.",
    {
      status:503,
      headers:{
        "Content-Type":"text/plain; charset=utf-8",
        "Cache-Control":"no-store"
      }
    }
  );
}

self.addEventListener("install",event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);

    try {
      for(const url of URLS){
        const response=await fetch(url,{
          cache:"reload",
          credentials:"same-origin",
          redirect:"error"
        });

        if(!response.ok || response.type==="opaque"){
          throw new Error("No se pudo descargar "+url);
        }

        const contentType=(
          response.headers.get("Content-Type") || ""
        ).toLowerCase();

        if(
          !new URL(url).pathname.endsWith(".html") &&
          contentType.includes("text/html")
        ){
          throw new Error("El servidor devolvió HTML para "+url);
        }

        await cache.put(url,response);
      }

      for(const url of URLS){
        if(!(await cache.match(url))){
          throw new Error("Publicación incompleta.");
        }
      }
    } catch(error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();

    await Promise.all(
      keys.filter(key=>
        key.startsWith(PREFIX) && key!==CACHE_NAME
      ).map(key=>caches.delete(key))
    );
  })());
});

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET") return;

  const url=new URL(request.url);
  if(url.origin!==BASE.origin) return;

  if(
    request.mode==="navigate" &&
    NAV_PATHS.has(url.pathname)
  ){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE_NAME);
      return await cache.match(INDEX) || unavailable();
    })());
    return;
  }

  if(ALLOWED.has(url.href)){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE_NAME);
      return await cache.match(url.href) || unavailable();
    })());
  }
});
