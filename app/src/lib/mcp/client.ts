import { MCPClient } from '@mastra/mcp'

/**
 * MCP client for runtime use inside Mastra agents.
 * Each agent request gets a fresh client with tools injected.
 *
 * Servers:
 *  - supabase : ad-hoc DB queries (open-ended stats the user asks in chat)
 *  - fetch    : YouTube search, USDA food lookup, web research
 *  - memory   : long-term user preferences and injury history (mem0)
 */
export function createMCPClient() {
  return new MCPClient({
    servers: {
      supabase: {
        command: 'uvx',
        args: ['mcp-server-supabase@latest'],
        env: {
          SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
          SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        },
      },
      fetch: {
        command: 'uvx',
        args: ['mcp-server-fetch@latest'],
      },
      ...(process.env.MEM0_API_KEY
        ? {
            memory: {
              command: 'uvx',
              args: ['mem0-mcp@latest'],
              env: {
                MEM0_API_KEY: process.env.MEM0_API_KEY,
              },
            },
          }
        : {}),
    },
  })
}

export type AppMCPClient = ReturnType<typeof createMCPClient>
