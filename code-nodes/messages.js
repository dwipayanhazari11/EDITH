/**
 * EDITH Centralized Messaging & Persona Templates
 * Single source of truth for all user-facing strings.
 */

const MESSAGES = {
  // Operational Greetings & Help
  START: `EDITH online. Send me a meeting transcript or a .txt file, and I'll turn it into actionable tasks.

Core Capabilities:
• Extract structured action items, owners, and deadlines
• Zero-hallucination tracking (unknown = flagged)
• Real-time sync with Google Sheets
• Executive summaries posted to your team group
• Automated follow-ups on pending tasks

Commands:
/start - Display operational status
/help - Detailed command & formatting guide
/tasks - View active and overdue action items
/register - Register your Telegram handle
/update <task_id> <status> - Update task status
/ask <query> - Query meeting decisions and tasks`,

  HELP: `EDITH Command & Submission Guide

How to submit a meeting:
1. Upload a plain .txt export file from Google Meet or Zoom.
2. Or paste transcript text (over 300 characters) directly.
3. Or send /upload_meeting followed by transcript text.

Commands:
/start - Show bot status
/help - View this guide
/tasks - List active and overdue action items
/register - Link your Telegram ID to team database
/update <task_id> <status> - Update task (e.g. /update TSK-1001 completed)
/ask <query> - Ask questions about meetings or decisions`,

  // Processing Acknowledgments
  ANALYZING: `EDITH is analysing your meeting...`,

  // Validation & Error Handling
  INVALID_INPUT_PREFIX: `Unable to process this transcript. Please upload a valid TXT file or paste your meeting transcript.`,

  FALLBACK: `⚠️ EDITH could not understand that.

Send a meeting transcript, upload a .txt file, or type /help to view available commands.`,

  // Specific Validation Failure Reasons
  REASONS: {
    EMPTY: `The provided text or file is completely empty.`,
    UNSUPPORTED_TYPE: `Unsupported file format. Only plain text (.txt) files are supported.`,
    FILE_TOO_LARGE: `File size exceeds the 200 KB limit. Please split or summarize the transcript.`,
    TOO_SHORT: `Transcript is too brief. Meeting transcripts must contain at least 300 characters or 3 distinct speaker turns.`,
    GIBBERISH: `Input text appears to be unreadable or contains an excessive proportion of random symbols.`,
    MISSING_DATE: `Could not identify a meeting date in the text or header. Please provide the meeting date (e.g., "Date: YYYY-MM-DD").`
  },

  // Clarification & Duplicate Notifications
  DUPLICATE_NOTICE: (meetingId, processedAt) => 
    `ℹ️ Duplicate transcript detected.\nMeeting was already processed on ${processedAt} (ID: ${meetingId}).\nNo duplicate tasks were created.`,

  DATE_REQUEST: `⚠️ Meeting date could not be determined.\n\nPlease reply with the date when this meeting took place (e.g., "2026-11-06" or "Nov 6, 2026").`
};

/**
 * Builds formatted invalid input message with reason.
 */
function formatInvalidInput(reasonKey, customDetail) {
  const reasonText = customDetail || MESSAGES.REASONS[reasonKey] || 'Invalid transcript format.';
  return `${MESSAGES.INVALID_INPUT_PREFIX}\n\nReason: ${reasonText}`;
}

module.exports = {
  MESSAGES,
  formatInvalidInput
};
