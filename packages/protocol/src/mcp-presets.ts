/** Vendor catalogue. No credentials or automatic execution; command entries require review. */
import { Type, type Static } from 'typebox';
export const McpPresetSchema = Type.Object({
 id: Type.String(), name: Type.String(), url: Type.String(),
 group: Type.Optional(Type.String()), auth: Type.String(), description: Type.Optional(Type.String()),
 docsUrl: Type.Optional(Type.String()), tokenUrl: Type.Optional(Type.String()), appUrl: Type.Optional(Type.String()),
 steps: Type.Optional(Type.Array(Type.String())), cli: Type.Optional(Type.String()),
 command: Type.Optional(Type.Object({ command: Type.String(), args: Type.Array(Type.String()) })),
 envNames: Type.Optional(Type.Array(Type.String())),
});
export type McpPreset = Static<typeof McpPresetSchema>;
export const MCP_PRESET_GROUPS = ['Issue tracking', 'Code', 'Docs', 'Observability', 'Cloud', 'Databases', 'Design and productivity', 'Browsers and testing'];
export const MCP_PRESETS: readonly McpPreset[] = [
 { id: 'atlassian', name: 'Atlassian · Jira and Confluence', group: 'Issue tracking', url: 'https://mcp.atlassian.com/v2/mcp?tools=all', auth: 'oauth', description: 'Jira issues and Confluence pages. Your organization may need to approve the callback domain.', docsUrl: 'https://support.atlassian.com/atlassian-ai-gateway/docs/get-started-with-the-atlassian-remote-mcp-server/', cli: 'acli' },
 { id: 'linear', name: 'Linear', group: 'Issue tracking', url: 'https://mcp.linear.app/mcp/readonly', auth: 'oauth', description: 'Read-only issues, projects and planning.', docsUrl: 'https://linear.app/docs/mcp' },
 { id: 'asana', name: 'Asana', group: 'Issue tracking', url: 'https://mcp.asana.com/v2/mcp', auth: 'registered_oauth', description: 'Tasks and projects through an approved MCP app. Not an ordinary personal token.', docsUrl: 'https://developers.asana.com/docs/integrating-with-asanas-mcp-server', appUrl: 'https://app.asana.com/0/developer-console', steps: ['Create an MCP app in the developer console.', 'Register the exact callback below; check workspace approval and HTTPS requirements.', 'Paste the app client ID and secret, then sign in.'] },
 { id: 'github', name: 'GitHub', group: 'Code', url: 'https://api.githubcopilot.com/mcp/readonly', auth: 'token', description: 'Read-only repositories, pull requests, issues and Actions. Use a fine-grained token with minimal repository permissions.', docsUrl: 'https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md', tokenUrl: 'https://github.com/settings/personal-access-tokens/new', cli: 'gh' },
 { id: 'notion', name: 'Notion', group: 'Docs', url: 'https://mcp.notion.com/mcp', auth: 'oauth', description: 'Pages and workspace tools. OAuth or a Business/Enterprise MCP token, not a REST integration token.', docsUrl: 'https://developers.notion.com/guides/mcp/get-started-with-mcp' },
 { id: 'context7', name: 'Context7', group: 'Docs', url: 'https://mcp.context7.com/mcp', auth: 'none', description: 'Current library and framework documentation. Optional bearer API key for higher quota.', docsUrl: 'https://github.com/upstash/context7', tokenUrl: 'https://context7.com/dashboard' },
 { id: 'cloudflare_docs', name: 'Cloudflare Docs', group: 'Docs', url: 'https://docs.mcp.cloudflare.com/mcp', auth: 'none', description: 'Read-only Cloudflare developer documentation. No account needed.', docsUrl: 'https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/' },
 { id: 'aws_knowledge', name: 'AWS Knowledge', group: 'Docs', url: 'https://knowledge-mcp.global.api.aws', auth: 'none', description: 'Read-only AWS documentation, API references and architecture. Rate-limited; no IAM credentials needed.', docsUrl: 'https://awslabs.github.io/mcp/servers/aws-knowledge-mcp-server' },
 { id: 'sentry', name: 'Sentry', group: 'Observability', url: 'https://mcp.sentry.dev/mcp', auth: 'oauth', description: 'Investigate errors and connect incidents to code.', docsUrl: 'https://docs.sentry.io/product/sentry-mcp/' },
 { id: 'pagerduty', name: 'PagerDuty', group: 'Observability', url: 'https://mcp.pagerduty.com/mcp', auth: 'registered_oauth', description: 'Incident response with a registered OAuth app. A normal API key is not a bearer token.', docsUrl: 'https://support.pagerduty.com/main/docs/mcp-server', appUrl: 'https://developer.pagerduty.com/', steps: ['Create an OAuth app with the incident permissions you need.', 'Register the exact callback below.', 'Paste the client ID and optional secret, then sign in.'] },
 { id: 'vercel', name: 'Vercel', group: 'Cloud', url: 'https://mcp.vercel.com', auth: 'oauth', description: 'Deployment failures, projects and Vercel documentation.', docsUrl: 'https://vercel.com/docs/mcp/vercel-mcp' },
 { id: 'firebase', name: 'Firebase', group: 'Cloud', url: '', auth: 'command', description: 'Runs Firebase tools on the backend. Uses Firebase CLI authentication; review permissions before enabling.', docsUrl: 'https://firebase.google.com/docs/ai-assistance/mcp-server', command: { command: 'npx', args: ['-y', 'firebase-tools@latest', 'mcp'] } },
 { id: 'supabase', name: 'Supabase', group: 'Databases', url: 'https://mcp.supabase.com/mcp?read_only=true', auth: 'oauth', description: 'Read-only SQL, schema and debugging. Scope to a project before enabling production access.', docsUrl: 'https://supabase.com/docs/guides/getting-started/mcp' },
 { id: 'postgres', name: 'Postgres', group: 'Databases', url: '', auth: 'command', description: 'Community Postgres MCP Pro (not the archived reference server). Restricted mode; use a read-only database role. Requires uvx on the backend.', docsUrl: 'https://github.com/crystaldba/postgres-mcp', command: { command: 'uvx', args: ['postgres-mcp', '--access-mode=restricted'] }, envNames: ['DATABASE_URI'] },
 { id: 'postman', name: 'Postman', group: 'Browsers and testing', url: 'https://mcp.postman.com/minimal', auth: 'oauth', description: 'API collections and specifications with the minimal tool set.', docsUrl: 'https://learning.postman.com/docs/developer/postman-api/postman-mcp-server/' },
 { id: 'playwright', name: 'Playwright', group: 'Browsers and testing', url: '', auth: 'command', description: 'Browser automation on the backend, not on this device. Review before running downloaded code.', docsUrl: 'https://github.com/microsoft/playwright-mcp', command: { command: 'npx', args: ['@playwright/mcp@latest'] } },
 { id: 'chrome_devtools', name: 'Chrome DevTools', group: 'Browsers and testing', url: '', auth: 'command', description: 'Inspect and debug a backend browser. Browser sessions can expose signed-in data.', docsUrl: 'https://github.com/ChromeDevTools/chrome-devtools-mcp', command: { command: 'npx', args: ['chrome-devtools-mcp@latest'] } },
 { id: 'slack', name: 'Slack', group: 'Design and productivity', url: 'https://mcp.slack.com/mcp', auth: 'registered_oauth', description: 'Search and work in Slack. Requires an internal or Marketplace app, not an unlisted app or arbitrary bot token.', docsUrl: 'https://docs.slack.dev/ai/slack-mcp-server', appUrl: 'https://api.slack.com/apps', steps: ['Create an internal or Marketplace Slack app and enable MCP.', 'Configure user scopes, approval and the exact callback below; Slack may require HTTPS.', 'Paste the app client ID and secret, then sign in.'] },
 { id: 'canva', name: 'Canva', group: 'Design and productivity', url: 'https://mcp.canva.com/mcp', auth: 'registered_oauth', description: 'Design, search and export. Requires Canva MCP app access; account approval and plan limits apply.', docsUrl: 'https://www.canva.dev/docs/apps/mcp/access/', appUrl: 'https://www.canva.com/developers/', steps: ['Create an app in the Developer Portal and enable Canva MCP.', 'Register the exact callback below; check account access and HTTPS requirements.', 'Paste the client ID and secret, then sign in.'] },
];
export function mcpCliSetupMessage(cli: string): string {
 if (cli !== 'gh' && cli !== 'acli') throw new Error('Unsupported CLI');
 const name = cli === 'gh' ? 'GitHub CLI (gh)' : 'Atlassian CLI (acli) for Jira';
 return `Please set up the ${name} on this backend for this project: install it if missing, sign me in (use the headless login steps if there is no browser), and check that it works.`;
}
/** Only documented, non-secret options; all other query strings remain forbidden. */
export function mcpPresetQueryAllowed(url: URL): boolean {
 if (!url.search) return true;
 const preset = MCP_PRESETS.find(p => p.url && new URL(p.url).origin === url.origin && new URL(p.url).pathname === url.pathname);
 return !!preset && [...url.searchParams].every(([key, value]) => url.searchParams.getAll(key).length === 1 && (
  (preset.id === 'atlassian' && key === 'tools' && value === 'all') ||
  (preset.id === 'supabase' && ((key === 'read_only' && value === 'true') || (key === 'project_ref' && /^[a-z0-9]{1,64}$/.test(value))))
 ));
}
