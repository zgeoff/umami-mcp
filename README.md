# @zgeoff/umami-mcp

A [Model Context Protocol](https://modelcontextprotocol.io/) server exposing [Umami](https://umami.is/) analytics — Cloud and self-hosted — as read-only tools.

> A TypeScript port of [Alurith/umami-mcp-server](https://github.com/Alurith/umami-mcp-server) (Python, MIT) by Alessandro Ferrini — tool surface and behaviour mirror the original; all credit for the design to its author.

## Tools

All tools are read-only.

- `get_websites` — list websites, with pagination and search
- `get_stats` — summary statistics for a time range
- `get_pageviews` — pageview/session series bucketed by hour/day/month/year
- `get_metrics` — ranked breakdowns (url, referrer, browser, country, event, …)
- `get_active` — visitors active in the last 5 minutes

## Configuration

Auth is one of two modes:

| Variable | Mode | Notes |
| --- | --- | --- |
| `UMAMI_API_KEY` | Umami Cloud | required for Cloud; wins when both modes are set |
| `UMAMI_USERNAME` + `UMAMI_PASSWORD` | self-hosted | rejected against Umami Cloud |
| `UMAMI_API_BASE` | both | API root; defaults to `https://api.umami.is/v1`. Self-hosted: `https://your-umami.example/api` |

## Usage

```json
{
  "mcpServers": {
    "umami": {
      "command": "npx",
      "args": ["-y", "@zgeoff/umami-mcp"],
      "env": {
        "UMAMI_API_BASE": "https://your-umami.example/api",
        "UMAMI_USERNAME": "admin",
        "UMAMI_PASSWORD": "…"
      }
    }
  }
}
```

## Development

```bash
npm install
npm test
npm run build
```
