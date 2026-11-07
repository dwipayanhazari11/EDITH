# EDITH — Pitch & Architecture Summary for Judges

> *"Turning Every Meeting into Measurable Action."*

---

## 1. One-Paragraph Executive Pitch

Every week, student hackathon teams, club committees, and engineering squads spend hours in meetings only for critical commitments to evaporate into messy chat logs, untracked spreadsheets, and missed deadlines. **EDITH** (Efficient Digital Intelligence for Team Handling) is an autonomous, Telegram-first Chief-of-Staff agent that transforms messy meeting transcripts into measurable, accountable action. Built on an event-driven self-hosted n8n engine, Google Gemini 3.8 Flash structured reasoning, and Google Sheets database persistence, EDITH extracts verified action items with strict zero-hallucination guardrails, interactively resolves missing owners and ambiguous deadlines directly in chat, tracks cross-meeting memory across sprints without duplicate tasks, and proactively follows up through a 4-stage escalating reminder engine. With EDITH, teams don't just talk about work—every spoken commitment becomes a tracked, delivered reality with zero administrative overhead.

---

## 2. One-Slide Architecture Summary (Judge Briefing)

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                  EDITH SYSTEM TOPOLOGY                                 │
└────────────────────────────────────────────────────────────────────────────────────────┘

   [ Telegram Client ] (Group / Private DM)
           │
           │ (HTTPS Ingress via Cloudflare Tunnel)
           ▼
 ┌───────────────────────────────────────────────────────────────────────────────────────┐
 │                               n8n ORCHESTRATION ENGINE                                │
 │                                                                                       │
 │  EDITH_00_router ────────► Classifies & Dispatches Messages, Documents & Buttons      │
 │        │                                                                              │
 │        ├──► EDITH_01_process_transcript (Normalizes Meet transcripts & SHA-256 hash) │
 │        ├──► EDITH_02_clarification_and_updates (Resolves items via inline callbacks) │
 │        ├──► EDITH_03_reminders (Daily 09:00 IST 4-stage escalating reminder cron)    │
 │        ├──► EDITH_04_nl_query (Grounded natural language query answering)             │
 │        └──► EDITH_99_error_handler (Global retry-on-fail and alert resilience)        │
 └─────────────────────────┬───────────────────────────────────┬─────────────────────────┘
                           │                                   │
              (Strict Structured Output)               (Relational DB)
                           ▼                                   ▼
             ┌───────────────────────────┐       ┌───────────────────────────┐
             │    GOOGLE GEMINI 3.8      │       │       GOOGLE SHEETS       │
             │         FLASH             │       │      (EDITH Database)     │
             │ • Low temperature (0.1)   │       │ • Meetings Tab            │
             │ • Strict responseSchema   │       │ • ActionItems Tab         │
             │ • Self-healing repair     │       │ • OpenQuestions Tab       │
             │ • Memory context injection│       │ • Members Tab             │
             │ • Natural language match  │       │ • Config Tab              │
             └───────────────────────────┘       └───────────────────────────┘
```

### Architectural Highlights & Key Differentiators

| Dimension | How EDITH Solves It | Hackathon Impact |
| :--- | :--- | :--- |
| **Zero-Hallucination Invariant** | Unknown owners or deadlines are strictly enforced as `null` and flagged; relative deadlines (*"Friday"*) are anchored against IST meeting dates. | Judges never see made-up tasks or invented assignees. |
| **Token-Efficient Deduplication** | SHA-256 hash of normalized transcript + chat ID checked against `Meetings` tab before triggering the LLM. | Zero duplicate meetings, zero wasted tokens. |
| **Self-Healing AI Loop** | If Gemini emits malformed JSON, a targeted repair prompt runs with an automated retry counter (max 2 retries) before graceful fallback. | Bulletproof resilience under transient LLM syntax glitches. |
| **Interactive In-Chat Resolution** | Incomplete tasks automatically generate sub-64-byte Telegram inline buttons (`act\|TSK-XXXX\|me`, `tomorrow`, `friday`). | Eliminates context-switching; team members resolve ambiguity with one tap. |
| **4-Stage Proactive Escalation** | Scheduled cron runs at 09:00 AM IST evaluating: T-2 days $\rightarrow$ T-1 day $\rightarrow$ Due Today $\rightarrow$ Overdue, routed directly to private DMs with anti-spam suppression. | Real accountability that actively chases deliverables. |
| **Cross-Meeting Sprint Memory** | Pulls open tasks from the last 3 meetings; reports like *"the frontend is done"* mark earlier tasks `completed` without duplicating action items. | True continuity between sprints and standups. |
| **Grounded NL Query Agent** | Team members can ask *"What are my pending tasks?"*, *"Which tasks are overdue?"*, or *"Is the frontend ready?"* answered exclusively from sheet records. | Instant executive visibility for students and mentors alike. |
