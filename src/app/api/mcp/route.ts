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
    `Search the Warren Buffett archive (1957–2024) using hybrid keyword + semantic retrieval.
Use this first when answering questions about Buffett's views, decisions, or writings.
Returns ranked passages with year, source type, and English/Chinese excerpts.
Combine with get_document to read the full context of a passage, or with graph to explore entity relationships.
Source types: shareholder (annual letters), partnership (early partnership letters), annual_meeting, article, interview.`,
    searchParams.shape,
    async (params) => {
      const result = await toolSearch(params);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "get_document",
    `Retrieve the full content of a specific document from the Buffett archive, paginated at 10 chunks per page.
Identify a document by sourceId (from search results) or by year + type.
Types: shareholder | partnership | annual_meeting | article | interview.
Use page parameter to read through long documents. Check totalPages in the response to know when you've reached the end.
Example: year=2023, type="shareholder" retrieves the 2023 Berkshire shareholder letter.`,
    getDocumentParams.shape,
    async (params) => {
      const result = await toolGetDocument(params);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "graph",
    `Query the knowledge graph for structured relationships around an entity (company, concept, or person).
Relationships are extracted from Buffett's writings — e.g. holdings, acquisitions, mentions of investment principles.
Use this to complement search results when you need structured, time-stamped relationship data.
Returns: from → relation → to, with year and source quote where available.
Example entities: "Apple", "Berkshire Hathaway", "insurance float", "GEICO".`,
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
