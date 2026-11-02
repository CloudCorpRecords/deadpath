/**
 * deadpath MCP server. Tools: find_dead_exports.
 *
 * Why the low-level Server instead of McpServer: the high-level
 * helper converts zod schemas to JSON Schema and injects keys
 * not in this tool's defined spec ("$schema" and
 * "additionalProperties"), which breaks exact tool-list/schema
 * parity with the spec. This file serves tools/list with the
 * spec's exact input schema as an explicit literal, and every
 * tools/call is validated by the core, which names the
 * offending path on invalid input.
 *
 * The analysis is pure local computation: no upstream API,
 * no authentication, no configuration.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { findDeadExports, formatPayload, VERSION } from "./deadpath.js";

const TOOLS = [
  {
    name: "find_dead_exports",
    description:
      "Find exported names that no module imports: dead exports with import-graph proof, per module and as a flat list.",
    inputSchema: {
      type: "object" as const,
      properties: {
        modules: {
          type: "array",
          description: "Modules in the set (at least one)",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Module path (unique across the set)",
              },
              exports: {
                type: "array",
                description: "Names this module exports (optional, default [])",
                items: { type: "string" },
              },
              imports: {
                type: "array",
                description: "Imports this module makes (optional, default [])",
                items: {
                  type: "object",
                  properties: {
                    from: {
                      type: "string",
                      description:
                        "Path of the module imported from (must be one of the supplied modules)",
                    },
                    names: {
                      type: "array",
                      description:
                        "Names imported from that module; an empty list is a side-effect import and uses no named exports (optional, default [])",
                      items: { type: "string" },
                    },
                  },
                  required: ["from"],
                },
              },
              entry: {
                type: "boolean",
                description:
                  "True for entry modules: all their exports count as used public surface (optional, default false)",
              },
            },
            required: ["path"],
          },
        },
      },
      required: ["modules"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "deadpath", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let out: unknown;
    if (name === "find_dead_exports") {
      const raw = (args ?? {}) as Record<string, unknown>;
      out = findDeadExports(raw.modules);
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(formatPayload(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
