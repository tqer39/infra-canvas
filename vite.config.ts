import { handleLLMRequest } from './src/assistant/llm-server.js';
import { handleRepositoryRequest } from './src/assistant/server.js';
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [
    {
      name: 'repository-reader',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          void handleLLMRequest(req, res)
            .then((handled) => handled || handleRepositoryRequest(req, res))
            .then((handled) => {
              if (!handled) next();
            })
            .catch(() => res.writeHead(500).end());
        });
      },
    },
  ],
  server: { host: '127.0.0.1', port: 5178 },
  build: { outDir: 'dist/web' },
});
