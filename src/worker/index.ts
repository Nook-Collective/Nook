import { handleRequest } from "./app";
import type { Env } from "./env";

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
