import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import fastifyStatic from "@fastify/static";

interface WebRoutesOptions {
  development: boolean;
}

const webRoutesPlugin: FastifyPluginAsync<WebRoutesOptions> = async (app, options) => {
  const { webRoot } = app.finance.config;

  if (options.development) {
    const { default: fastifyVite } = await import("@fastify/vite");
    await app.register(fastifyVite, {
      root: webRoot,
      dev: true,
      spa: true,
    });
    await app.vite.ready();
    for (const route of ["/funds", "/expenses", "/statistics"]) {
      app.get(route, (_request, reply) => reply.html());
    }
  } else {
    const distRoot = path.join(webRoot, "dist", "client");
    await app.register(fastifyStatic, {
      root: distRoot,
      prefix: "/",
      wildcard: false,
      index: false,
      maxAge: "1y",
      immutable: true,
    });
    for (const route of ["/funds", "/expenses", "/statistics"]) {
      app.get(route, (_request, reply) => {
        reply.header("Cache-Control", "no-store");
        return reply.sendFile("index.html", { cacheControl: false });
      });
    }
  }

  app.get("/favicon.ico", async (_request, reply) => reply.redirect("/favicon.svg"));
  app.get("/", async (_request, reply) => reply.redirect("/expenses"));
};

// Vite's Connect middleware must run in the root Fastify scope so it also
// receives module requests such as /@vite/client and /src/main.tsx.
export const webRoutes = fp(webRoutesPlugin, { name: "finance-web-routes" });
