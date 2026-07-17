#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadSettings } from './settings.js';
import { UmamiClient } from './umami-client.js';

/**
 * Query filters shared by the stats, pageviews, and metrics tools. Mirrors the fields the Umami
 * API accepts; absent fields are simply omitted from the request.
 */
const filtersShape = {
  path: z.string().optional().describe('Filter by URL path'),
  referrer: z.string().optional().describe('Filter by referrer'),
  title: z.string().optional().describe('Filter by page title'),
  query: z.string().optional().describe('Filter by query string'),
  browser: z.string().optional().describe('Filter by browser'),
  os: z.string().optional().describe('Filter by operating system'),
  device: z.string().optional().describe('Filter by device type'),
  country: z.string().optional().describe('Filter by country code'),
  region: z.string().optional().describe('Filter by region'),
  city: z.string().optional().describe('Filter by city'),
  hostname: z.string().optional().describe('Filter by hostname'),
  tag: z.string().optional().describe('Filter by tag'),
  segment: z.string().optional().describe('Filter by segment id'),
  cohort: z.string().optional().describe('Filter by cohort id'),
};

const filtersSchema = z.object(filtersShape).optional().describe('Optional result filters');

const startAtSchema = z
  .string()
  .datetime({ offset: true })
  .optional()
  .describe('Range start as an ISO 8601 timestamp; defaults to 7 days before the range end');

const endAtSchema = z
  .string()
  .datetime({ offset: true })
  .optional()
  .describe('Range end as an ISO 8601 timestamp; defaults to now');

type Filters = z.infer<typeof filtersSchema>;

/**
 * Umami expects epoch-millisecond `startAt`/`endAt` query params; tools accept ISO strings and
 * default to the trailing 7 days.
 */
function toTimerangeQuery(startAt?: string, endAt?: string): Record<string, string> {
  const end = endAt !== undefined ? new Date(endAt).getTime() : Date.now();
  const start = startAt !== undefined ? new Date(startAt).getTime() : end - 7 * 24 * 3600 * 1000;

  if (end <= start) {
    throw new Error('end_at must be after start_at');
  }

  return { startAt: String(start), endAt: String(end) };
}

function toFiltersQuery(filters: Filters): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filters ?? {}).filter(([, value]) => value !== undefined),
  ) as Record<string, string>;
}

function toToolResult(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function toErrorResult(error: unknown) {
  return {
    content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

async function main(): Promise<void> {
  const settings = loadSettings();
  const client = new UmamiClient(settings);
  const server = new McpServer({ name: 'umami-mcp', version: '0.1.0' });

  server.registerTool(
    'get_websites',
    {
      title: 'List websites',
      description: 'List the websites the account can access, with pagination and search.',
      annotations: READ_ONLY,
      inputSchema: {
        include_teams: z.boolean().default(false).describe('Include team websites'),
        search: z.string().optional().describe('Search term to filter websites'),
        page: z.number().int().min(1).default(1).describe('Page number'),
        page_size: z.number().int().min(1).max(200).default(10).describe('Results per page'),
      },
    },
    async ({ include_teams, search, page, page_size }) => {
      try {
        return toToolResult(
          await client.getWebsites({
            includeTeams: include_teams,
            search,
            page,
            pageSize: page_size,
          }),
        );
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'get_stats',
    {
      title: 'Get visitor statistics',
      description:
        'Summary statistics for a website over a time range: pageviews, visitors, visits, bounces, total time.',
      annotations: READ_ONLY,
      inputSchema: {
        website_id: z.string().describe('Website id (from get_websites)'),
        start_at: startAtSchema,
        end_at: endAtSchema,
        filters: filtersSchema,
      },
    },
    async ({ website_id, start_at, end_at, filters }) => {
      try {
        return toToolResult(
          await client.getStats(website_id, {
            ...toTimerangeQuery(start_at, end_at),
            ...toFiltersQuery(filters),
          }),
        );
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'get_pageviews',
    {
      title: 'Get pageviews over time',
      description: 'Pageview and session series for a website, bucketed by hour, day, month, or year.',
      annotations: READ_ONLY,
      inputSchema: {
        website_id: z.string().describe('Website id (from get_websites)'),
        start_at: startAtSchema,
        end_at: endAtSchema,
        unit: z.enum(['hour', 'day', 'month', 'year']).default('day').describe('Bucket size'),
        timezone: z.string().default('UTC').describe('IANA timezone for bucketing'),
        compare: z.enum(['prev', 'yoy']).optional().describe('Comparison window: previous period or year-over-year'),
        filters: filtersSchema,
      },
    },
    async ({ website_id, start_at, end_at, unit, timezone, compare, filters }) => {
      try {
        return toToolResult(
          await client.getPageviews(website_id, {
            ...toTimerangeQuery(start_at, end_at),
            unit,
            timezone,
            ...(compare !== undefined ? { compare } : {}),
            ...toFiltersQuery(filters),
          }),
        );
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'get_metrics',
    {
      title: 'Get metrics breakdown',
      description:
        'Ranked metrics for a website over a time range: type is one of url, referrer, browser, os, device, country, region, city, language, screen, event, hostname, tag.',
      annotations: READ_ONLY,
      inputSchema: {
        website_id: z.string().describe('Website id (from get_websites)'),
        type: z.string().describe('Metric type, e.g. url, referrer, browser, country, event'),
        start_at: startAtSchema,
        end_at: endAtSchema,
        limit: z.number().int().min(1).max(500).default(500).describe('Maximum results'),
        offset: z.number().int().min(0).default(0).describe('Result offset'),
        expanded: z.boolean().default(false).describe('Use the expanded metrics endpoint'),
        filters: filtersSchema,
      },
    },
    async ({ website_id, type, start_at, end_at, limit, offset, expanded, filters }) => {
      try {
        return toToolResult(
          await client.getMetrics(website_id, expanded, {
            ...toTimerangeQuery(start_at, end_at),
            type,
            limit: String(limit),
            offset: String(offset),
            ...toFiltersQuery(filters),
          }),
        );
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'get_active',
    {
      title: 'Get active visitors',
      description: 'Number of visitors active on the website within the last 5 minutes.',
      annotations: READ_ONLY,
      inputSchema: {
        website_id: z.string().describe('Website id (from get_websites)'),
      },
    },
    async ({ website_id }) => {
      try {
        return toToolResult(await client.getActive(website_id));
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('umami-mcp connected over stdio');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
