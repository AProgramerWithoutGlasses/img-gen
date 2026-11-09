// Advertise the official catalog without opening the desktop app.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { connect, requestedDocument } from './lib/figcraft.mjs';

try {
  const catalogClient = await connect({ headless: true });
  let catalog;
  try { catalog = await catalogClient.listTools(); }
  finally { await catalogClient.close(); }

  const server = new Server({ name: 'UI Studio FigCraft', version: '1.0.0' }, { capabilities: { tools: {} } });
  let desktopClient;
  server.setRequestHandler(ListToolsRequestSchema, async () => catalog);
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const target = requestedDocument(request.params.name, request.params.arguments);
    desktopClient ??= connect({ document: target }).catch(error => { desktopClient = undefined; throw error; });
    const client = await desktopClient;
    return client.callTool(request.params, undefined, { timeout: 100_000 });
  });
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
