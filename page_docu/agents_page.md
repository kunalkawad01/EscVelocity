# AgentsPage — `/agents`

## 1. What It Is Doing

Static showcase of four AI research agents. Each card displays the agent name, role, capabilities list, and associated MCP tools. No API calls are made. The page is purely informational — it tells users what the agents can do, not actually runs them. Includes an architecture diagram showing the data flow: `User → Agent → MCP → Feature Store → Output`.

The four agents are:
- **Market Regime Agent** — reads macro signals, regime scores, breadth
- **Stock DNA Agent** — reads stock-level composite scores, fundamentals
- **Pattern Edge Agent** — reads pattern detections, historical edge
- **Options Flow Agent** — reads options chain data, IV surface, strategies

A pulsing "Active" status dot implies live readiness but is cosmetic only.

---

## 2. Optimization

- **No API integration exists** — the page is a placeholder. Every "capability" listed is unimplemented until the MCP layer (Phase 4) ships.
- Hero section uses a radial gradient glow (hardcoded rgba) — move to the `usePalette()` + `CYAN` token system to avoid dark/light mode breakage.
- The 2-column agent card grid uses hardcoded `maxWidth: 900` — should use the standard responsive `<Grid>` layout from IndicatorsPage.
- Duplicate agent card structure is a good candidate for a shared `<AgentCard>` component.

---

## 3. Lessons Learnt

- Static showcase pages have a shelf-life problem: the list of capabilities will drift from what is actually implemented unless there is a contract (MCP tool registry) that feeds this page.
- A pulsing "Active" badge misleads users into thinking agents are functional before Phase 4 ships. Prefer an honest "Coming Soon" state that flips to "Active" when the MCP endpoint is registered.

---

## 4. Business Logic

None currently. Future business logic:
- Agent routing: match user query intent → correct agent → MCP tool selection
- Agent memory: conversation context per session so agents can maintain research threads
- Multi-agent orchestration: Market Regime Agent feeds context to Options Flow Agent (regime-conditioned IV strategy)

---

## 5. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Material UI, `usePalette()` hooks |
| Data | None (static) |
| Charts | None |
| State | None |

---

## 6. Suggestions to Achieve the Objective

1. **Wire to MCP registry** — on page load, fetch `/api/mcp/tools` to get the actual list of registered tools and populate agent capability cards dynamically. This makes the page self-updating and honest.
2. **Add an agent chat demo** — embed a minimal chat widget per agent card. When the user types a question, route it to the relevant MCP tool and stream the response. This makes the page functional, not decorative.
3. **Show live run count / last used** — display when each agent was last queried and by which research question. Adds credibility and reveals actual usage.
4. **Multi-agent pipeline diagram** — interactive flow: click a regime → see which agents activate → which MCP tools fire → what output feeds portfolio construction. Directly serves the portfolio construction objective.
5. **Link to validation docs** — each agent card should link to the validation results of the features it consumes. This enforces the "Research precedes product" principle.
