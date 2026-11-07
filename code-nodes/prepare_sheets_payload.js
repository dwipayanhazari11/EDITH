/**
 * EDITH Google Sheets Payload & Members Lookup (code-nodes/prepare_sheets_payload.js)
 * 
 * Generates deterministic IDs using make_ids algorithms, performs case-insensitive
 * & first-name matching against the Members tab to populate owner_telegram_id,
 * and structures efficient batch payloads for Meetings, ActionItems, and OpenQuestions.
 */

const crypto = require('crypto');

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function normaliseTaskText(task) {
  return (task || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function generateTaskId(meetingId, taskText, owner) {
  const normTask = normaliseTaskText(taskText);
  const normOwner = (owner || 'none').toLowerCase().trim();
  const seed = `${meetingId}_${normTask}_${normOwner}`;
  return 'TSK-' + sha256(seed).substring(0, 6).toUpperCase();
}

function generateQuestionId(meetingId, questionText) {
  const normQ = normaliseTaskText(questionText);
  const seed = `${meetingId}_${normQ}`;
  return 'QST-' + sha256(seed).substring(0, 6).toUpperCase();
}

// Retrieve members from Read Members Tab node (if available)
let membersList = [];
try {
  membersList = $('Read Members Tab').all().map(i => i.json);
} catch (e) {
  membersList = [];
}

function lookupMemberTelegramId(ownerName) {
  if (!ownerName || typeof ownerName !== 'string') return '';
  const cleanName = ownerName.trim().toLowerCase();
  if (!cleanName || cleanName === 'none' || cleanName === 'null') return '';

  const firstName = cleanName.split(' ')[0];

  // 1. Try exact full name match (case-insensitive)
  let match = membersList.find(m => (m.name || '').trim().toLowerCase() === cleanName);

  // 2. Fall back to first-name match
  if (!match) {
    match = membersList.find(m => (m.name || '').trim().split(' ')[0].toLowerCase() === firstName);
  }

  if (match) {
    const handle = match.telegram_username || (match.telegram_id ? `@${match.telegram_id}` : '');
    return handle ? (handle.startsWith('@') ? handle : `@${handle}`) : '';
  }

  // Blank if not found
  return '';
}

function processPrepareSheetsPayload(items, members = membersList) {
  const results = [];

  for (const item of items) {
  const json = item.json;
  const analysis = json.data || json.analysis || {};
  const chatId = json.chat_id;
  const meetingDate = json.meeting_date || analysis.meeting_date || new Date().toISOString().slice(0, 10);
  const transcriptHash = json.transcript_hash || '';
  const meetingId = json.meeting_id || ('MTG-' + transcriptHash.substring(0, 8).toUpperCase());

  // Timestamp in IST (Asia/Kolkata, UTC+5:30)
  const nowStr = new Date(Date.now() + 330 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  const meetingTitle = (analysis.meeting_title || 'Untitled Meeting').trim();
  const meetingSummary = (analysis.meeting_summary || '').trim();

  // 1. Format Decisions & Key Points
  const decisions = Array.isArray(analysis.decisions) ? analysis.decisions : [];
  const keyPoints = Array.isArray(analysis.key_points) ? analysis.key_points : [];

  const decisionsText = decisions.map(d => `${d.confirmed ? '✅' : '⚠️'} ${d.text}`).join('\n');
  const keyPointsText = keyPoints.map(k => `• ${k}`).join('\n');

  // Meeting Row (for Meetings tab)
  const meetingRow = {
    meeting_id: meetingId,
    meeting_date: meetingDate,
    title: meetingTitle,
    summary: meetingSummary,
    decisions: decisionsText,
    key_points: keyPointsText,
    transcript_hash: transcriptHash,
    chat_id: String(chatId),
    processed_at: nowStr
  };

  // 2. Format Action Items Rows (for ActionItems tab)
  const rawItems = Array.isArray(analysis.action_items) ? analysis.action_items : [];
  const actionItemsRows = [];
  const clarificationItems = [];

  for (const raw of rawItems) {
    const taskName = (raw.task || '').trim();
    const owner = raw.owner ? String(raw.owner).trim() : '';
    const taskId = generateTaskId(meetingId, taskName, owner);

    // Look up owner_telegram_id from Members tab
    const ownerTelegramId = lookupMemberTelegramId(owner);

    const deadlinePhrase = raw.deadline_phrase ? String(raw.deadline_phrase).trim() : '';
    const deadlineIso = raw.deadline_iso ? String(raw.deadline_iso).trim() : '';
    const status = raw.status || (owner && deadlineIso ? 'assigned' : 'unassigned');
    const sourceQuote = (raw.source_quote || '').trim();

    actionItemsRows.push({
      task_id: taskId,
      meeting_id: meetingId,
      task: taskName,
      owner: owner,
      owner_telegram_id: ownerTelegramId,
      deadline: deadlineIso,
      deadline_phrase: deadlinePhrase,
      status: status,
      source_quote: sourceQuote,
      last_reminder_stage: 0,
      created_at: nowStr,
      updated_at: nowStr
    });

    if (status === 'unassigned' || status === 'ambiguous_deadline' || status === 'missing_deadline' || status === 'conflicting_deadline') {
      clarificationItems.push({
        task_id: taskId,
        task: taskName,
        owner: owner,
        status: status,
        deadline_phrase: deadlinePhrase,
        source_quote: sourceQuote
      });
    }
  }

  // Phase 10: Process updates_to_existing_tasks (Meeting Memory)
  const updatesToExisting = Array.isArray(analysis.updates_to_existing_tasks) ? analysis.updates_to_existing_tasks : [];
  for (const u of updatesToExisting) {
    const existingTaskId = u.existing_task_id;
    if (!existingTaskId) continue;

    if (u.change === 'completed') {
      actionItemsRows.push({
        task_id: existingTaskId,
        status: 'completed',
        updated_at: nowStr
      });
    } else if (u.change === 'deadline_changed' && u.new_deadline_iso) {
      actionItemsRows.push({
        task_id: existingTaskId,
        deadline: u.new_deadline_iso,
        status: 'assigned',
        updated_at: nowStr
      });
    }
  }

  // 3. Format Open Questions Rows (for OpenQuestions tab)
  const rawQuestions = Array.isArray(analysis.open_questions) ? analysis.open_questions : [];
  const openQuestionsRows = [];

  for (const q of rawQuestions) {
    const questionText = (q.question || '').trim();
    const questionId = generateQuestionId(meetingId, questionText);

    openQuestionsRows.push({
      question_id: questionId,
      meeting_id: meetingId,
      question: questionText,
      related_task_id: (q.related_task || '').trim(),
      responsible_person: (q.responsible_person || '').trim(),
      status: 'open'
    });
  }

  // 4. Construct Telegram Meeting Summary Message
  let summaryMsg = `📋 **Meeting: ${meetingTitle}**\n📅 **Date:** ${meetingDate}\n\n`;
  summaryMsg += `**Summary:**\n${meetingSummary || 'No summary provided.'}\n\n`;

  if (decisions.length > 0) {
    summaryMsg += `**Decisions:**\n`;
    for (const d of decisions) {
      summaryMsg += `• ${d.confirmed ? '✅' : '⚠️'} ${d.text}\n`;
    }
    summaryMsg += `\n`;
  }

  summaryMsg += `**Action Items (${actionItemsRows.length} logged):**\n`;
  if (actionItemsRows.length === 0) {
    summaryMsg += `No discrete action items identified.\n`;
  } else {
    actionItemsRows.forEach((item, idx) => {
      const isComplete = item.status === 'assigned';
      const badge = isComplete ? '✅' : '⚠️';
      const ownerDisplay = item.owner_telegram_id || (item.owner ? `@${item.owner}` : 'Unassigned');
      const deadlineDisplay = item.deadline ? `📅 ${item.deadline}` : (item.deadline_phrase ? `📅 Ambiguous ("${item.deadline_phrase}")` : '📅 No deadline');
      summaryMsg += `${idx + 1}. ${badge} ${item.task} — ${ownerDisplay} | ${deadlineDisplay}\n`;
    });
  }

  summaryMsg += `\n*Logged to EDITH Database.*`;

  // 5. Construct Telegram Clarification Message (if any)
  let clarificationMsg = '';
  if (clarificationItems.length > 0) {
    clarificationMsg = `⚠️ **Clarification Required (${clarificationItems.length} items):**\n\n`;
    clarificationItems.forEach((item, idx) => {
      clarificationMsg += `${idx + 1}. **"${item.task}"** (${item.task_id})\n`;
      if (item.status === 'unassigned') {
        clarificationMsg += `   • Issue: Owner unspecified.\n   • Action: Who is responsible?\n`;
      } else if (item.status === 'ambiguous_deadline') {
        clarificationMsg += `   • Issue: Ambiguous deadline ("${item.deadline_phrase}").\n   • Action: What is the exact target date?\n`;
      } else if (item.status === 'missing_deadline') {
        clarificationMsg += `   • Issue: No deadline specified.\n   • Action: When is this due?\n`;
      } else if (item.status === 'conflicting_deadline') {
        clarificationMsg += `   • Issue: Conflicting deadlines ("${item.deadline_phrase}").\n   • Action: Please confirm the final target date.\n`;
      }
      if (item.source_quote) {
        clarificationMsg += `   • Source: _"${item.source_quote}"_\n`;
      }
      clarificationMsg += `\n`;
    });
    clarificationMsg += `Reply with: \`/update <task_id> <status>\` or update in Google Sheets.`;
  }

  results.push({
    json: {
      meeting_id: meetingId,
      chat_id: chatId,
      meeting_row: meetingRow,
      action_items_rows: actionItemsRows,
      open_questions_rows: openQuestionsRows,
      updates_to_existing_tasks: updatesToExisting,
      summary_message: summaryMsg,
      clarification_message: clarificationMsg,
      has_open_questions: openQuestionsRows.length > 0,
      has_clarifications: clarificationItems.length > 0
    }
  });
}

return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sha256,
    normaliseTaskText,
    generateTaskId,
    generateQuestionId,
    processPrepareSheetsPayload
  };
}

if (typeof $input !== 'undefined') {
  return processPrepareSheetsPayload($input.all());
}
