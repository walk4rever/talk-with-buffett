import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  searchParams, toolSearch,
  getDocumentParams, toolGetDocument,
  graphParams, toolGraph,
} from "@/lib/mcp-tools";

export const maxDuration = 60;

function createServer() {
  const server = new McpServer({
    name: "buffett-archive",
    version: "1.0.0",
  });

  server.tool(
    "search",
    "Search the Warren Buffett archive for relevant passages. Returns chunks ranked by relevance.",
    searchParams.shape,
    async (params) => {
      const result = await toolSearch(params);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "get_document",
    "Retrieve a specific document (annual letter, speech, article) by source ID or year+type. Returns paginated chunks.",
    getDocumentParams.shape,
    async (params) => {
      const result = await toolGetDocument(params);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "graph",
    "Look up relationships for an entity (company, concept, person) in the knowledge graph. Returns structured relationships extracted from Buffett's writings.",
    graphParams.shape,
    async (params) => {
      const result = await toolGraph(params);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  return server;
}

async function handler(req: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session management needed
  });
  const server = createServer();
  await server.connect(transport);
  return transport.handleRequest(req);
}

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
