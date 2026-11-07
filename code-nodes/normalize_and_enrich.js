/**
 * EDITH Normalizer, Validator & Enricher
 * 
 * Safely parses Gemini structured output, validates against core rules,
 * generates deterministic IDs, resolves relative deadlines, and formats
 * records for Google Sheets and Telegram.
 */

const crypto = require('crypto');

const items = $input.all();
const results = [];

// Optional: Retrieve Members tab data if present
let members = [];
try {
  members = $('Read Members Tab').all().map(i => i.json);
} catch (e) {
  members = [];
}

function findMemberHandle(name) {
  if (!name) return '';
  const clean = name.trim().toLowerCase();
  const match = members.find(m => (m.name || '').toLowerCase() === clean);
  if (match) {
    return match.telegram_username || (match.telegram_id ? `@${match.telegram_id}` : '');
  }
  return name.startsWith('@') ? name : `@${name}`;
}

function resolveRelativeDate(phrase, baseDateStr) {
  if (!phrase || !baseDateStr) return null;
  const lower = phrase.toLowerCase().trim();

  // If already an ISO date YYYY-MM-DD
  const isoMatch = lower.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];

  const base = new Date(baseDateStr + 'T00:00:00+05:30');
  if (isNaN(base.getTime())) return null;

  const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  
  if (lower.includes('today')) {
    return base.toISOString().slice(0, 10);
  }
  if (lower.includes('tomorrow')) {
    const next = new Date(base.getTime() + 24 * 60 * 60 * 1000);
    return next.toISOString().slice(0, 10);
  }

  for (let i = 0; i < 7; i++) {
    const dayName = daysOfWeek[i];
    if (lower.includes(dayName)) {
      const currentDay = base.getDay();
      let diff = i - currentDay;
      if (diff <= 0) diff += 7; // Next occurrence
      const target = new Date(base.getTime() + diff * 24 * 60 * 60 * 1000);
      return target.toISOString().slice(0, 10);
    }
  }

  return null;
}

for (const item of items) {
  const json = item.json;

  // Retrieve Gemini raw response
  let rawAiText = '';
  if (json.candidates && json.candidates[0]?.content?.parts[0]?.text) {
    rawAiText = json.candidates[0].content.parts[0].text;
  } else if (json.text) {
    rawAiText = json.text;
  }

  // Parse JSON safely
  let analysis = null;
  try {
    const cleanJson = rawAiText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    analysis = JSON.parse(cleanJson);
  } catch (err) {
    throw new Error(`Failed to parse Gemini JSON output: ${err.message}. Raw text: ${rawAiText.slice(0, 200)}`);
  }

  // Meeting Metadata
  const nowStr = new Date(Date.now() + 330 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const meetingDate = analysis.meeting_date || json.meeting_date || nowStr.slice(0, 10);
  const title = (analysis.title || 'Untitled Meeting').trim();
  const summary = (analysis.summary || '').trim();
  const decisions = Array.isArray(analysis.decisions) ? analysis.decisions : [];
  const keyPoints = Array.isArray(analysis.key_points) ? analysis.key_points : [];
  const transcriptHash = json.transcript_hash || crypto.createHash('sha256').update(json.normalised_text || '').digest('hex');
  const chatId = json.chat_id;

  // Generate deterministic Meeting ID (MTG- + 8 hex chars)
  const meetingId = 'MTG-' + crypto.createHash('md5').update(title + meetingDate + transcriptHash).digest('hex').substring(0, 8).toUpperCase();

  // Process Action Items
  const rawItems = Array.isArray(analysis.action_items) ? analysis.action_items : [];
  const actionItemsRows = [];
  const clarificationItems = [];

  let taskSeq = 1001;
  for (const raw of rawItems) {
    const taskId = `TSK-${taskSeq++}`;
    const taskName = (raw.task || '').trim();
    let owner = raw.owner ? String(raw.owner).trim() : null;
    let deadline = raw.deadline ? String(raw.deadline).trim() : null;
    const deadlinePhrase = raw.deadline_phrase ? String(raw.deadline_phrase).trim() : null;
    let status = raw.status || 'assigned';
    const sourceQuote = (raw.source_quote || '').trim();

    // Check for vague deadline phrases
    const isVagueDeadline = deadlinePhrase && /(soon|sometime|next week|later|in a few days|next sprint|eventually)/i.test(deadlinePhrase);

    // Rule 1 & 2 Enforcements
    if (!owner || owner.toLowerCase() === 'unassigned' || owner.toLowerCase() === 'null') {
      owner = null;
      status = 'unassigned';
    }

    if (isVagueDeadline) {
      deadline = null;
      status = 'ambiguous_deadline';
    } else if (deadlinePhrase && !deadline) {
      // Attempt relative date resolution anchored to meetingDate in Asia/Kolkata
      deadline = resolveRelativeDate(deadlinePhrase, meetingDate);
      if (!deadline) {
        status = 'ambiguous_deadline';
      }
    } else if (!deadline && !deadlinePhrase) {
      status = 'missing_deadline';
    }

    // Owner telegram handle lookup
    const ownerTelegramId = owner ? findMemberHandle(owner) : '';

    // Flag for clarification if needed
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

    actionItemsRows.push({
      task_id: taskId,
      meeting_id: meetingId,
      task: taskName,
      owner: owner || '',
      owner_telegram_id: ownerTelegramId,
      deadline: deadline || '',
      deadline_phrase: deadlinePhrase || '',
      status: status,
      source_quote: sourceQuote,
      last_reminder_stage: 0,
      created_at: nowStr,
      updated_at: nowStr
    });
  }

  // Process Open Questions
  const rawQuestions = Array.isArray(analysis.open_questions) ? analysis.open_questions : [];
  const openQuestionsRows = [];
  let qSeq = 1;
  for (const q of rawQuestions) {
    openQuestionsRows.push({
      question_id: `QST-${String(qSeq++).padStart(3, '0')}`,
      meeting_id: meetingId,
      question: (q.question || '').trim(),
      related_task_id: '',
      responsible_person: (q.responsible_person || '').trim(),
      status: 'open'
    });
  }

  // Format Decisions & Key Points for Sheets
  const decisionsFormatted = decisions.map(d => `• ${d}`).join('\n');
  const keyPointsFormatted = keyPoints.map(k => `• ${k}`).join('\n');

  // Format Google Sheets Meeting Row
  const meetingRow = {
    meeting_id: meetingId,
    meeting_date: meetingDate,
    title: title,
    summary: summary,
    decisions: decisionsFormatted,
    key_points: keyPointsFormatted,
    transcript_hash: transcriptHash,
    chat_id: String(chatId),
    processed_at: nowStr
  };

  results.push({
    json: {
      meeting_id: meetingId,
      chat_id: chatId,
      meeting_date: meetingDate,
      title: title,
      summary: summary,
      decisions: decisions,
      meeting_row: meetingRow,
      action_items_rows: actionItemsRows,
      open_questions_rows: openQuestionsRows,
      clarification_items: clarificationItems,
      total_tasks: actionItemsRows.length,
      pending_clarifications: clarificationItems.length
    }
  });
}

return results;
