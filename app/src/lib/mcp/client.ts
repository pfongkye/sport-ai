import { MCPClient } from '@mastra/mcp'

/**
 * MCP client for runtime use inside Mastra agents.
 *
 * Must be a SINGLETON: Mastra throws "MCPClient was initialized multiple times
 * with the same configuration" if you construct a second client with identical
 * server config (memory-leak guard). Building one per request therefore fails
 * on every request after the first. We cache one instance for the process.
 *
 * Servers:
 *  - supabase : ad-hoc DB queries (open-ended stats the user asks in chat)
 *  - fetch    : YouTube search, USDA food lookup, web research
 *  - memory   : long-term user preferences and injury history (mem0)
 */
let cached: MCPClient | null = null

export function getMCPClient(): MCPClient {
  if (cached) return cached
  cached = new MCPClient({
    id: 'sportai-mcp',
    servers: {
      supabase: {
        command: 'uvx',
        args: ['mcp-server-supabase@latest'],
        env: {
          SUPABASE_URL: process.env.SUPABASE_INTERNAL_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
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
              env: { MEM0_API_KEY: process.env.MEM0_API_KEY },
            },
          }
        : {}),
    },
  })
  return cached
}

export type AppMCPClient = MCPClient
