# Provider sign-in when sharing aiki

Research for T55, reviewed **10 November 2026** (host-local date; fetched pages are dated 9 November UTC).

**Scope:** friends and colleagues install their own backend. the operator's decision is to keep the pi agent loop and call providers directly through `@earendil-works/pi-ai`, with today's sign-in flows. No Claude Code, Agent SDK, Codex, or agent-CLI wrapper is proposed. This is a product-risk assessment, **not legal advice or a conclusion about an individual user's contract**. Policies, availability, and enforcement can change independently.

## Recommendation in eight points

1. **Keep direct pi-ai. Prefer Anthropic/OpenAI API keys and OpenCode Go's plan API key as the least ambiguous launch options.** Explain whose account pays, model access, limits, and data handling. A consumer subscription is not automatically an API balance; some plans now include specific API credits.
2. **Offer `openai` → “Sign in with ChatGPT” as the preferred subscription connection**, for eligible accounts in a local, open-source distribution. OpenAI explicitly documents direct Responses API calls for this use. It is not a licence for an unapproved paid/hosted service. Verify the integration against the current preview requirements before promising support.
3. **Keep `openai-codex` device login as a compatibility option**, not a way to evade an organization's refusal to enable ChatGPT sharing. OpenAI publicly welcomes pi and other harnesses, but this flow reuses Codex's client/backend rather than the new app-specific consent flow. Explain its greater compatibility/support risk; don't claim that OpenAI certified this app.
4. **Retained Claude subscription OAuth must be conspicuously high-risk and opt-in, not the recommended Claude connection.** Current Anthropic docs explicitly oppose third-party Claude.ai login/token routing. pi's Claude Code-like identity does not make it Claude Code. A warning records informed choice; it does **not** create permission. Seek written clarification/approval before representing this as supported or approved.
5. **One person, their account, their machine/backend.** Never ship credentials, pool friends' subscriptions, resell access, rotate accounts to defeat limits, or send tokens to the operator. Local ownership reduces credential/account-sharing risk; it does not fix an otherwise disallowed token use.
6. **Show a provider-specific notice before sign-in**, plus persistent auth-method, billing, quota, disconnect, and failure information. Respect admin controls and rate limits. Do not silently switch to paid API usage or another account. Warn that autonomous workers, maintenance, and cache warming can consume allowance without a new chat message.
7. **Do not expand launch subscriptions just because pi supports them.** OpenCode explicitly supports external harnesses; Google has explicitly enforced against OAuth piggybacking. Copilot and other plan integrations need their own review. API availability, OAuth implementation, and permission to reuse a consumer plan are different facts.
8. **Keep a usable key-based fallback and an exit path.** Provider errors must not destroy conversations or trigger endless refresh/retry loops. Protect backend credentials and authenticate remote access before inviting users; origin checks and a 0600 file alone are not multi-user security.

If the app ships with unchanged flows and no additional safeguards, describe that as an **experimental private pilot with known gaps**, not a provider-approved general release. The recommendation above does not change the operator's architecture decision or implement any UI changes.

## What the current app actually does

Read: [`models.ts`](../../packages/server/src/models.ts), [`logins.ts`](../../packages/server/src/logins.ts), [`credentials.ts`](../../packages/server/src/credentials.ts), [DESIGN: Models](../DESIGN.md#models), and [sharing research](sharing-the-app.md).

- Only four providers are exposed: `opencode-go`, `anthropic`, `openai`, `openai-codex`. More pi factories are not automatically app features.
- The Bun backend performs login and inference; web/native clients relay prompts and events. Login sessions survive a page reload. Pasted answers are not kept in the login history. API keys and OAuth credentials are stored in backend-local `credentials.json` with owner-only permissions, **not encrypted merely because they are 0600**.
- Claude goes through pi's subscription OAuth and its own model requests. DESIGN says it presents as Claude Code, including its user agent, system prompt and tool naming. This is not the user's unmodified Claude Code process.
- `openai` uses the new ChatGPT direct-token sharing flow, or an API key. The installed pi-ai **1.4.0** OAuth code uses `dynamic_agent_client`, `ext_agent_host_id`, PKCE and `chatgpt.tokens.use.direct`, then calls `api.openai.com`. `openai-codex` instead uses the Codex client ID and device login, with Codex-backed inference. These are not interchangeable grants.
- `openai-codex` was retained because a workspace refused app sharing. That is a compatibility observation in the code, **not evidence of administrator permission** to use the other route.
- Request logging, cache-retention wrappers, compaction and memory calls depend on direct `Models` calls. These remain intact under the chosen architecture. No real account, sign-in, model request, or credential was used in this research.

## 1. Anthropic

### Current primary sources and their limits

**Consumer Terms**, effective 8 October 2025, [sections 1 and 3](https://www.anthropic.com/legal/consumer-terms):

> “You may not share your Account login information, Anthropic API key, or Account credentials with anyone else or make your Account available to anyone else.”

> “Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise.”

The second quote is an item in the prohibited-use list, not a general authorization for subscription automation. The terms also prohibit bypassing systems/protective measures. The same page says API-key/Console use is governed by the **Commercial Terms**, rather than consumer Pro terms. Enterprise/work accounts may have different agreements; don't generalize an individual's plan to colleagues.

**Claude Code legal/compliance**, [Authentication and credential use](https://code.claude.com/docs/en/legal-and-compliance), currently says:

> “Developers building products or services that interact with Claude’s capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider.”

> “Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users.”

> “Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic’s own flow.”

It reserves enforcement **“without prior notice.”** The same page now permits customers to offer the **unmodified Claude Code binary**, under stated commercial conditions, with each end user authenticating and paying directly. That exception is expressly about running the published binary, not implementing a lookalike API client.

**Agent SDK overview**, [current docs](https://code.claude.com/docs/en/agent-sdk/overview):

> “Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead.”

**Important current nuance:** don't quote February's blanket SDK restriction as though nothing changed. The official [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) help article says:

> “Update June 15, 2026: We’ve paused the previously-announced changes to Claude Agent SDK usage. For now, nothing has changed: Claude Agent SDK, claude -p, and third-party app usage still draw from your subscription limits.”

Its **7 October 2026** update says Max, Ultra and Team include monthly API credits, and:

> “Nothing changes for your plan: when you’re signed in with your Claude plan, the Claude Agent SDK and claude -p still draw from your subscription limits.”

**Interpretation:** the help article describes quota treatment on those surfaces; it does not grant every third-party app permission to collect subscription OAuth tokens. Read it alongside the legal page and the SDK's approval qualification. It does establish that “all SDK subscription use is now impossible” and “June's announced credit split took effect” are both unsafe summaries. None of these exceptions describes our direct pi OAuth client.

**Usage Policy**, [current policy](https://www.anthropic.com/legal/aup), covers the resulting work, not just login:

> “Intentionally bypass or interfere with capabilities, restrictions, or guardrails established within our products, including by circumvention of the account sign-up or log-in process … without prior authorization from Anthropic”

is prohibited. It also says:

> “Users are responsible for ensuring that agents they build or deploy, including actions those agents take through tools, browsers, or connected systems, comply with this Usage Policy.”

The policy requires consumer-facing bots/agents to disclose that they are AI. It does not provide a separate subscription-token exception for personal, noncommercial, or single-machine harnesses.

### What that means for the three routes

| Route | Source-backed fact | Risk assessment for this app |
| --- | --- | --- |
| pi directly uses OAuth meant for Claude Code | Anthropic explicitly restricts third-party login/token routing; our process is not Claude Code. | **Highest policy/enforcement risk.** Success today is not approval. Users could lose access, hit abuse filters, or face account action. No assurance about likelihood or scope. Keep only as the owner's knowingly chosen experimental option; recommend a key instead. |
| Official Agent SDK with the user's own Claude Code login | SDK/`claude -p` subscription usage still exists; approval qualifications and unmodified-binary conditions also exist. | Different integration boundary, not proof that any third-party app is automatically allowed. Relevant to T3, **not our implementation**. |
| User's Anthropic API key | Docs explicitly recommend Console keys or supported cloud-provider credentials for products. Commercial terms and Usage Policy still apply. | **Preferred direct-integration path.** Explain billing, optional eligible-plan API credits, workspace limits and data terms; no guarantee of unlimited or free usage. No resale or hidden intermediary billing. |

The approved documented route for a **custom agent loop** is the Claude API using an API key (or separately supported cloud inference credentials). Specific written permission could change the OAuth assessment; none for aiki was found. Owning the computer/account and letting the user click Anthropic's consent screen are worthwhile safeguards, **not a substitute for that permission**.

### Public statements and enforcement, 2025–2026

- **2025:** the consumer terms already contained the automated-access/API-key distinction. The 2025 Windsurf and rival-lab access disputes are sometimes cited here, but they concern other commercial/competitive arrangements; they are not clean evidence about a friend's private OAuth harness. Do not conflate them.
- **January 2026:** Anthropic's Thariq Shihipar [publicly stated](https://x.com/trq212/status/2009689809875591565): “Yesterday we tightened our safeguards against spoofing the Claude Code harness after accounts were banned for triggering abuse filters from third-party harnesses using Claude subscriptions.” This quote was available in search's indexed post; direct X rendering was not required for the finding. [The Register's 20 February report](https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546) quotes the same thread: “Third-party harnesses using Claude subscriptions create problems for users and are prohibited by our Terms of Service.” This is evidence of both technical enforcement and account-filter consequences, not evidence that all bans were deliberate or permanent.
- **February 2026:** that report records the then-current “including the Agent SDK” wording and removal of OpenCode authentication support after the dispute. It is a historical report, **not today's full SDK rule**. Local experimentation comments from staff should not be read as approval for distributing a new direct client.
- **May–June 2026:** a proposed separate SDK credit budget caused developer backlash, including T3 users. The official **15 June pause**, quoted above, supersedes reporting that the split was certain to take effect.
- **Current:** legal docs retain explicit restrictions on third-party login/token handling, while recognizing unmodified Claude Code and certain SDK usage. That distinction, not merely “Anthropic allows/forbids third-party tools,” is the useful boundary.

## 2. OpenAI

### Direct ChatGPT sharing: the strongest match for our architecture

OpenAI's [Sign in with ChatGPT overview](https://developers.openai.com/siwc) says:

> “Let users sign in with ChatGPT and use their ChatGPT plan for eligible AI requests in your app.”

The [ChatGPT plan-usage guide](https://developers.openai.com/siwc/token-sharing-open-source) is unusually explicit:

> “In addition to identity scopes, your open-source app can request permission to use the user’s ChatGPT plan for eligible Responses API requests.”

> “These docs explain ChatGPT plan usage for open-source and locally hosted apps. If you’re interested in offering it in a paid or remotely hosted app, complete the interest form.”

It identifies a laptop or **self-hosted VM** as an agent host; each host needs its own stable opaque ID. This is not limited to official Codex UI. The [cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) expressly discusses friends with eligible Plus/Pro downloading an open-source app and bringing their allowance. Actual plan/workspace eligibility and consent remain server-controlled; don't promise every Plus/Pro/work account works.

The [sign-in guide](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) says the direct flow:

> “needs neither a client secret nor a partner API key.”

It requires a real app name, stable host ID, PKCE/state/nonce, validation of the issued client ID and ID token, checking the granted `chatgpt.tokens.use.direct` scope, and protected credential storage. Authentication alone does not authorize plan use. This is close to pi's `openai` flow, not an exemption to all API restrictions.

**Important release check, not completed here:** verify pi-ai 1.4.0 against the latest guide. Static inspection found that it starts a fresh dynamic registration on every login, whereas current docs ask returning accounts to reuse the issued client ID. It sends a nonce, but the inspected module does not show the guide's full JWKS/signature/issuer/audience/nonce ID-token verification. A complete dependency/security audit was not performed. Don't market today's flow as fully conformant solely because the endpoint and scopes match.

The [inference guide](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) says:

> “Use the public Responses API endpoint above for this ChatGPT plan usage flow; do not point it at ChatGPT’s backend-api endpoints.”

The [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) require `store: false`, `stream: true` and full context over HTTP; list unsupported fields including `prompt_cache_retention`, `temperature`, and `max_output_tokens`; and exclude several hosted tools. Function/custom tool calls and local execution are distinct from unsupported hosted `tool_search`. This does **not** automatically prohibit our own tool discovery or pi workers. Check actual serialized requests rather than disabling all tools or assuming Codex feature parity. A usage-limit error can arrive after streaming starts; completion must be determined by the terminal event.

**Interpretation:** offer this as the preferred subscription method for an eligible local OSS release. A paid distribution, managed backend for friends, or closed-source release needs separate eligibility/approval review. The repo's [sharing research](sharing-the-app.md) says a root licence had not been chosen; meet the open-source condition before relying on it, rather than assuming a downloadable source checkout is enough.

### Codex CLI, app-server and device code

[Codex authentication docs](https://developers.openai.com/codex/auth) document ChatGPT subscription and separately billed API-key login. They explicitly describe headless device auth:

> “In these situations, prefer device code authentication (beta).”

Users/admins must enable it in personal security settings or workspace permissions. A device code is a way to authorize a particular client, **not a general API key, organization bypass, or extra allowance**. Never approve a code someone else supplied unless deliberately authorizing their machine.

The [app-server docs](https://developers.openai.com/codex/app-server#authentication) say:

> “If you’ve built a local or open-source application using Codex app-server authentication, you can continue using it, though we recommend migrating to Sign in with ChatGPT so users have greater control over and visibility into their usage.”

> “App-server authentication has never been permitted for commercial or hosted services.”

They support managed ChatGPT browser/device login and externally managed tokens; the latter is experimental. The [separate app-server sharing guide](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server) configures an authorized sharing token against public Responses. These are official integration options for context, **not a proposed implementation change here**.

There is also direct public support for other harnesses, not just wrappers. OpenAI's Tibo Sottiaux [said in January](https://x.com/thsottiaux/status/2009742187484065881) it was working with OpenCode to allow subscriptions there. On [23 May 2026](https://x.com/thsottiaux/status/2058071172361998482), he wrote:

> “About 5% of our production traffic is on the Pi harness, about another 5% is on OpenCode. Reminder you can use your ChatGPT account in a flourishing set of other tools.”

These X quotations were read from indexed search results. They strongly distinguish OpenAI's stance from Anthropic's, but they are not a signed approval of every pi fork, usage pattern, or commercial service.

| Launch option | Recommendation and caveat |
| --- | --- |
| `openai` ChatGPT sharing | **Preferred subscription route.** Explicit app consent, eligible local OSS context, provider-managed sharing limits; no access to the user's ChatGPT conversations is granted by this capability. Preview has narrower models/features than full API/Codex. Respect workspace refusal. |
| `openai-codex` device OAuth | **Retain as labelled compatibility flow** under the architecture decision. Public pi support lowers uncertainty relative to Claude; official device docs describe Codex, not a blanket promise about our reimplementation. Uses a different client/backend and may break independently. Never describe it as a sanctioned workaround for disabled sharing. |
| User's OpenAI API key | **Offer prominently.** Standard API billing, not automatically the user's Plus/Pro quota; any separate eligible API credits have their own conditions. Use project/key budgets, respect rate limits, no unannounced paid failover. |

OpenAI's [authentication guide](https://developers.openai.com/codex/auth) says:

> “Use API key authentication for programmatic Codex CLI workflows, such as CI/CD jobs.”

That recommendation matters for a harness with unattended jobs; neither CLI login nor public support for pi means unlimited background inference. Its new enterprise Codex access tokens are for defined trusted enterprise workflows, not generic Plus/Pro API credentials.

The general [Terms of Use](https://openai.com/policies/row-terms-of-use/) say **“You may not share your account credentials or make your account available to anyone else.”** This quote was verified through the official page's search-index excerpt; direct fetching returned HTTP 403. Use the applicable regional/business terms, plus current usage policies and integration-specific docs. Don't turn generic restrictions on automated extraction into a claim that all documented subscription inference is forbidden—or turn documented inference into permission to resell or evade limits.

**Enforcement finding:** no sourced provider-wide ban on pi/Codex subscription harnesses, nor T3-specific OpenAI policy ban, was found in this review. That is not a guarantee against individual suspensions, security challenges, workspace denial or future policy changes.

## 3. Other pi-ai providers

**Scope distinction:** only OpenCode Go is enabled in this app today. The installed 1.4.0 provider/auth modules and [upstream provider guide](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md) establish technical support, **not permission or a promise to add launch options**. Notes below cover the subscription/OAuth cases and group ordinary API services; this is not a full contractual audit of every model reseller.

| Provider / route | Source-backed fact and launch advice |
| --- | --- |
| **OpenCode Go** | Official [Harnesses docs](https://opencode.ai/docs/console/harnesses/) say “Console works with coding agents other than OpenCode” and list **Pi**, with pay-as-you-go and Go built in. **Keep at launch via the user's own Console key.** It is a plan API key, not Claude/ChatGPT OAuth. Use the correct Go endpoint, stable session ID (required), and plan limits. Free-tier chat models are restricted to OpenCode and return 403 elsewhere; don't promise them. [Go docs](https://opencode.ai/docs/console/go/) explain current plans/allowances. |
| **OpenCode Zen / paid Console inference** | Same official external-harness support, separately metered pay-as-you-go credits and a different endpoint from Go. Reasonable future API-key option, not currently registered. No transferable Claude subscription rights implied by selling a Claude model. |
| **GitHub Copilot** | GitHub now documents [third-party OAuth integration through its Copilot SDK](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth): “Copilot requests are made on behalf of each authenticated user, using their Copilot subscription.” This uses the developer's GitHub App/OAuth App and the SDK. It does **not establish permission for pi's existing direct Copilot client/token exchange**. Don't call all Copilot third-party use banned, but defer adding our direct integration until the exact route, client identity, seat/premium usage and organization policy are checked. No SDK migration is proposed. |
| **Google Gemini CLI OAuth** | Historically supported by pi versions/extensions; not present as a built-in OAuth module in the installed 1.4.0 inventory. Google's [27 February announcement](https://github.com/google-gemini/gemini-cli/discussions/20632) says “Using third-party software, tools, or services to harvest or piggyback on Gemini CLI's OAuth authentication to access our backend services is a direct violation of Gemini CLI’s applicable terms and policies.” **Do not add this subscription-token route.** Developer Gemini API/Vertex credentials are separate. |
| **Google Antigravity OAuth** | Same official announcement confirms actual Antigravity bans for “the use of 3rd party tools or proxies to access Antigravity resources and quotas,” with a reinstatement/recertification path. **Do not add a direct OAuth adapter** merely because an extension supports it. Official ACP/CLI integrations in other apps do not authorize token piggybacking here. |
| **Kimi For Coding** | [Official docs](https://www.kimi.com/code/docs/en/) say subscribers can obtain an API key for third-party development tools, and that third-party integration requires manual API-key configuration. pi also implements OAuth; that fact alone doesn't establish permission for our own OAuth client. Potential future **coding-plan key** option after checking permitted tools/use and regional endpoints. Moonshot's ordinary API balance is different. |
| **Z.AI GLM Coding Plan / China variant** | [Official tool list](https://docs.z.ai/devpack/tool/others) includes Pi, but says the plan is “limited to use within the following officially supported tools and product environments.” It is not unrestricted generic model hosting. Check that a distributed pi-derived app and its noncoding maintenance/research tasks are within scope before adding it. Use a normal API product where the coding-plan restrictions don't fit. |
| **OpenRouter OAuth / key** | [Official PKCE docs](https://openrouter.ai/docs/guides/overview/auth/oauth) explicitly let apps obtain a user-controlled key: requests “are billed to their own OpenRouter credits.” This is developer API-key provisioning, **not reuse of a Claude/ChatGPT consumer subscription**. Reasonable future direct route with user-selected spending limits and upstream model/data terms. Not enabled today. |
| **xAI Grok/X subscription OAuth; Meta Muse subscription OAuth; Radius OAuth** | Present in the pinned package, but no sufficiently specific first-party authorization for **this app's direct use** was established in this review. Radius is gateway authentication, not inherently a consumer-plan subsidy. **Defer all three**, rather than treating pi's login label or T3's separate provider arrangements as permission. API keys, where offered, still need product/billing review. |
| **Qwen token plans (global/China/Individual), Xiaomi MiMo token plans (regional)** | Plan-specific providers exist in pi. Their inclusion is not a reviewed grant for this harness. Defer until permitted tools, automation/noncoding use, regional routing and spending rules are checked; don't call all plan keys ordinary unrestricted API keys. |
| **Ordinary API/cloud providers** | pi supports Google Gemini/Vertex, Amazon Bedrock, Azure, Ant Ling, Baseten, Cerebras, Cloudflare AI Gateway/Workers AI, DeepSeek, Fireworks, Groq, Hugging Face, Mistral, MiniMax/global-China, Moonshot/global-China, NVIDIA NIM, Together, TypeSafe, Vercel AI Gateway, xAI, Meta and Xiaomi APIs. These are developer credentials/cloud IAM paths, not evidence that the corresponding consumer chat subscription is reusable. None is newly offered by this research. Review each service's current terms, model licence, geography, data retention and budgets before adding it. |

**Interpretation:** for launch, support the four providers already registered rather than expanding the policy and support surface. OpenCode Go has notably better explicit external-harness documentation than the restricted consumer-OAuth routes.

## 4. What T3 Code actually does, and trouble it has had

First-party project sources: [README](https://github.com/pingdotgg/t3code/blob/main/README.md), [FAQ](https://github.com/pingdotgg/t3code/blob/main/docs/user/faq.md), [Claude setup](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-claude.md), [Codex setup](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-codex.md), read from current raw files on the review date. These are moving branches, not a promise about every past/future release.

- Its FAQ says **“T3 Code uses those harnesses. It is not a harness, and it does not work without one.”** It identifies Anthropic's Agent SDK and Codex App Server. Claude setup uses Claude Code's login/configuration, not a pi-style replacement client masquerading as Claude Code.
- Codex setup offers **Connect with ChatGPT** (explicit allowance sharing) and separately an existing Codex CLI login. It says **“Running `codex login` does not change a managed ChatGPT connection.”** This is the same important distinction our app should explain, even though we don't use its app-server architecture.
- T3's FAQ claims **“We work with all of the labs and T3 Code is within the TOS of Claude Code, Codex, and Google Antigravity.”** That is a maintainer statement about **T3**, not provider confirmation for aiki. Do not repeat its “you can trust it is safe” promise in our app.
- It has had real **Claude friction**: its current FAQ says Agent SDK usage drains five-hour limits faster than Claude Code; the maintainer calls it an Anthropic bug and says weekly limits are unaffected. Attribute this to T3, rather than asserting an independently reproduced provider defect. [Issue #2680](https://github.com/pingdotgg/t3code/issues/2680) records concern about the announced May/June SDK billing change; the later official pause is the current answer. This was not proof that T3 was banned.
- It has had real **OpenAI compatibility trouble**: [#29992](https://github.com/pingdotgg/t3code/issues/29992) reports Connect-with-ChatGPT rejecting forked Codex subagent items and preventing continuation. [#17445](https://github.com/pingdotgg/t3code/issues/17445) reports expired-token 401s during long managed runs. These are user-reported protocol/token-lifecycle failures, not established enforcement for violating terms. They show why sharing needs capability/error handling even through an official agent runtime.
- No substantiated provider policy ban against T3 itself was found. Neither “T3 has never had trouble” nor “T3 is banned” is supported. Its choice of an official runtime, its provider discussions, and its billing/capability issues do not transfer permission or reliability to our direct pi client.

## 5. Cost and safeguards within the chosen architecture

### No runtime switch

The Agent SDK is an agent loop/context/tool runtime, not a drop-in Anthropic transport adapter. Using it or Claude Code would change tool execution, streaming, session recovery, compaction, permissions, cache controls and request observability; a nested agent behind a pi `Models` interface would not preserve the existing loop semantics automatically. Our own tools, coordinator/worker orchestration, caching and keep-warm would need reconciliation. **That option is out of scope by decision; no migration estimate or recommendation is needed.**

The middle path that **does fit** is local direct inference with per-user sign-in and a choice of API keys. It preserves pi and minimizes credential sharing. It **does not eliminate Anthropic's direct-OAuth restriction**. For OpenAI, local open-source direct plan sharing is itself a documented path, not merely a loophole. An own-machine rule is a sensible launch boundary, not a universal provider authorization.

### Suggested user notices

These are proposed text, **not implemented UI**:

**Claude subscription OAuth**

> This app calls Claude directly through pi-ai; it does not run Claude Code. Anthropic's current documentation does not permit third-party apps to offer Claude.ai login or route requests with subscription credentials. This connection is experimental and may stop working or lead to account restrictions. Using only your own account on your own machine does not remove that risk. An Anthropic API key is the recommended option; API billing/eligible credits are separate.

Require an explicit acknowledgement if retained. Don't disguise the option as ordinary supported Claude Code login, suggest that Anthropic approved it, or promise that a disclaimer prevents suspension.

**ChatGPT sharing (`openai`)**

> Authorize this installation to use your eligible ChatGPT plan allowance. This uses OpenAI's ChatGPT sharing flow, not a general API key and not access to your ChatGPT conversations. Availability, limits and supported capabilities depend on your plan and workspace. Workers and background tasks can use the allowance. A workspace administrator may disallow this connection. You can disconnect it; API-key use is billed separately.

**Codex compatibility login (`openai-codex`)**

> Uses pi-ai's Codex-compatible device login, not the Codex CLI. OpenAI supports third-party harness use, but this app's compatibility route may change or fail independently. Sign in only to your own account for your own installation. Do not use this to bypass organization restrictions. Prefer ChatGPT sharing when available, or use your own API key.

**API/plan keys**

> Requests use the account or workspace that owns this key and its provider's terms. Usage may incur charges or consume plan/API credits. Do not share a personal key with friends. Set provider-side budgets where available. This app will not silently change billing methods when an allowance runs out.

### Release checklist and rough engineering allowance

These are **estimates/interpretation**, not implemented work or verified guarantees. One engineer familiar with the repo; ranges overlap and exclude security review, provider approval and general T54 packaging.

- **Notices and billing clarity, 1–2 days:** distinguish all four auth routes, disclose direct pi identity, add acknowledgement for Claude OAuth, show key versus subscription, make logout/disconnect and reauthorization clear. No misleading “free API” or “official Claude Code” labels.
- **Conformance/capability pass, 2–4 days:** compare the pinned OpenAI sharing login with today's token-validation/client-registration requirements; exercise supported request shapes with stubs, terminal streaming failures, expired/rotated refresh tokens and cancellation. Test pi's tool/caching options against the sharing preview restrictions. Keep prompts/credentials out of debug exports. Do not interpret this research as the completed audit.
- **Usage/recovery controls, 1–3 days:** visible pause/stop, bounded worker concurrency and retries, no account rotation, no automatic paid failover, quota-aware background work. Make cache warming optional and clearly costed; consider disabling it by default for subscription sign-ins. Caching reduces repeated-context cost but **does not confer permission** or make warm-up calls free. Do not generate artificial traffic to evade limits.
- **Credential ownership and host boundary:** one user's backend and credentials; stable installation/host ID, honest app name, no baked-in tokens; owner-only file/parent directory permissions, redacted backups/logs and preferably OS-protected storage where practical. Never paste token files into support tickets. Protect relayed device codes and callback URLs as secrets.
- **Remote security is a separate launch gate:** as [T54 research](sharing-the-app.md#security-gate-before-sharing-remotely) records, the backend has no user/device authentication today. It is effectively shell access plus provider spending authority. Loopback first; no public endpoint, shared the operator backend, or colleague access without real authentication/authorization. This is not solved by OAuth, CORS/Origin checks or a private tailnet alone.
- **Publish a dated provider-support policy:** record which routes are experimental, how users revoke consent/provider sessions, and what happens if blocked. Recheck first-party docs before a public release. If Anthropic clarifies/approves this precise direct use, preserve that approval and update the notice; until then keep the known contradiction visible.

## Evidence quality and remaining uncertainty

Official documentation and current terms take priority over old reporting, maintainer assurances and snippets. Full pages were fetched using the URL-to-Markdown skill; web searches were sequential, with timeouts. X statements and the OpenAI general-terms quote are explicitly identified as indexed excerpts. Direct OpenAI terms fetching returned 403; the January VentureBeat article returned 429, so it is not the sole evidence for enforcement. June's billing pause was checked against the current official help article rather than relying on May's announcements.

No permission specific to aiki was located, no provider was contacted, and absence of a found ban is not proof of safety. The launch recommendation distinguishes documented integration support from account security, runtime compatibility, discretionary enforcement and future pricing. Research changed only this document; no production settings, login flows, UI or credentials were changed.
