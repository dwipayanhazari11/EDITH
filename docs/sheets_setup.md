# Google Sheets Setup Guide: "EDITH Database"

This document defines the schema, tab layouts, validation rules, and configuration formulas for the primary database powering EDITH: a Google Spreadsheet named **"EDITH Database"**.

---

## 1. Spreadsheet Overview

- **Spreadsheet Name**: `EDITH Database`
- **Timezone Setting**: File > Settings > Time zone: `(GMT+05:30) India Standard Time (Kolkata)`
- **Locale**: India / United States (ISO Date format `YYYY-MM-DD` preferred)
- **Tab List**:
  1. `Meetings`
  2. `ActionItems`
  3. `OpenQuestions`
  4. `Members`
  5. `Config`

---

## 2. Tab Schema Specifications

### Tab 1: `Meetings`
Records every parsed meeting session. Used for deduplication (`transcript_hash`) and historical reference.

| Column | Header | Type | Description / Constraints | Example |
| :--- | :--- | :--- | :--- | :--- |
| **A** | `meeting_id` | String | Unique ID (`MTG-` + 8-char hex or timestamp) | `MTG-7A9B1C2D` |
| **B** | `meeting_date` | Date | Meeting occurrence date (`YYYY-MM-DD`) | `2026-11-09` |
| **C** | `title` | String | Short title of the meeting | `Sprint 4 Architecture Sync` |
| **D** | `summary` | Text | Executive summary of discussion (2–4 sentences) | `Reviewed auth refactor and staging blockers.` |
| **E** | `decisions` | Text | JSON array or newline-separated bullet list of decisions | `• Adopt JWT rotation\n• Defer search index` |
| **F** | `key_points` | Text | Major context or discussion topics | `• Staging CPU spikes under load\n• Mock data ready` |
| **G** | `transcript_hash`| String | SHA-256 hash of raw input (used for deduplication) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e464...` |
| **H** | `chat_id` | String | Telegram group or private chat ID | `-1001987654321` |
| **I** | `processed_at` | DateTime | Timestamp when parsed and saved (`YYYY-MM-DD HH:mm:ss`) | `2026-11-06 23:30:00` |

---

### Tab 2: `ActionItems`
The operational core of EDITH. Stores discrete, assignable tasks.

| Column | Header | Type | Description / Constraints | Example |
| :--- | :--- | :--- | :--- | :--- |
| **A** | `task_id` | String | Unique task ID (`TSK-` + sequence / hash) | `TSK-1001` |
| **B** | `meeting_id` | String | Foreign key matching `Meetings.meeting_id` | `MTG-7A9B1C2D` |
| **C** | `task` | String | Actionable title starting with a verb | `Finalize JWT middleware` |
| **D** | `owner` | String | Name of assignee or blank if unassigned | `Dwipayan` |
| **E** | `owner_telegram_id` | String | Telegram ID or `@username` mapped from Members | `@dwipayan` |
| **F** | `deadline` | Date | Resolved deadline (`YYYY-MM-DD`) or blank | `2026-11-13` |
| **G** | `deadline_phrase` | String | Verbatim phrase spoken in transcript | `by this Friday` |
| **H** | `status` | Enum | Validated status dropdown (see Status Enum below) | `assigned` |
| **I** | `source_quote` | Text | Exact sentence from transcript proving commitment | `"I'll finish the JWT middleware by this Friday."` |
| **J** | `last_reminder_stage`| Integer | Stage of last sent reminder (0=none, 1=t-24h, 2=overdue) | `0` |
| **K** | `created_at` | DateTime | Creation timestamp (`YYYY-MM-DD HH:mm:ss`) | `2026-11-06 23:30:00` |
| **L** | `updated_at` | DateTime | Last modification timestamp | `2026-11-06 23:30:00` |

#### `status` Enum Data Validation:
Set Data Validation on `ActionItems!H2:H`:
- Criteria: **List of items**
- Allowed values:
  `assigned, missing_deadline, ambiguous_deadline, conflicting_deadline, unassigned, in_progress, completed, overdue`

---

### Tab 3: `OpenQuestions`
Tracks unresolved items, blockers, or questions requiring decision.

| Column | Header | Type | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| **A** | `question_id` | String | Unique ID (`QST-` + sequence) | `QST-001` |
| **B** | `meeting_id` | String | Foreign key to `Meetings.meeting_id` | `MTG-7A9B1C2D` |
| **C** | `question` | Text | The unresolved query or dependency | `Do we need Redis cluster or standalone?` |
| **D** | `related_task_id` | String | Optional link to `ActionItems.task_id` | `TSK-1002` |
| **E** | `responsible_person`| String | Person tasked with finding the answer | `Sarah` |
| **F** | `status` | Enum | `open`, `answered`, `dropped` | `open` |

---

### Tab 4: `Members`
Maps team members' spoken names/nicknames to Telegram identifiers.

| Column | Header | Type | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| **A** | `name` | String | Full name or common nickname spoken in transcripts | `Dwipayan` |
| **B** | `telegram_username` | String | Telegram handle (with `@`) | `@dwipayan_dev` |
| **C** | `telegram_id` | String | Numeric Telegram User ID (for direct mentions) | `987654321` |
| **D** | `chat_id` | String | Direct message chat ID for private notifications | `987654321` |

---

### Tab 5: `Config`
Dynamic runtime settings queried by n8n workflows.

| Column | Header | Type | Description | Example Value |
| :--- | :--- | :--- | :--- | :--- |
| **A** | `key` | String | Configuration key | `default_timezone` |
| **B** | `value` | String | Configuration value | `Asia/Kolkata` |

#### Standard Default Config Rows:
| key | value |
| :--- | :--- |
| `default_timezone` | `Asia/Kolkata` |
| `group_chat_id` | `-1001234567890` |
| `reminder_hour` | `09:00` |
| `staged_reminders_enabled` | `true` |
| `deduplication_window_days`| `30` |

---

## 3. Recommended Conditional Formatting

To make the sheet immediately visual:
1. **`ActionItems!H:H` (Status)**:
   - `completed`: Light green background (`#D9EAD3`), dark green text.
   - `overdue`: Light red background (`#F4CCCC`), dark red text.
   - `unassigned`: Light orange background (`#FCE5CD`), dark orange text.
   - `ambiguous_deadline` / `missing_deadline`: Light yellow background (`#FFF2CC`), dark brown text.
2. **`ActionItems!F:F` (Deadline)**:
   - Highlight overdue dates automatically:
     Formula: `=AND(ISDATE(F2), F2 < TODAY(), H2 <> "completed")`
     Style: Bold red text with red fill.
