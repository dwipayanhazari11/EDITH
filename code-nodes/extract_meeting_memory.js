/**
 * EDITH Meeting Memory & Open Tasks Extractor (code-nodes/extract_meeting_memory.js)
 * 
 * Fetches open action items from the last 3 meetings of the originating chat,
 * formatting them as contextual memory for the Gemini meeting analysis prompt.
 */

function extractMeetingMemory(currentChatId, meetings = [], tasks = []) {
  if (!currentChatId) {
    return 'Earlier Open Tasks: None recorded.';
  }

  const strChatId = String(currentChatId);

  // 1. Filter meetings for this specific chat
  const chatMeetings = meetings.filter(m => String(m.chat_id || '') === strChatId);
  if (chatMeetings.length === 0) {
    return 'Earlier Open Tasks: None recorded from previous meetings of this group.';
  }

  // 2. Sort by meeting_date (or processed_at) descending and pick up to 3
  const sortedMeetings = [...chatMeetings].sort((a, b) => {
    const dateA = a.meeting_date || a.processed_at || '';
    const dateB = b.meeting_date || b.processed_at || '';
    return String(dateB).localeCompare(String(dateA));
  });

  const last3Meetings = sortedMeetings.slice(0, 3);
  const last3MeetingIds = new Set(last3Meetings.map(m => m.meeting_id).filter(Boolean));

  // 3. Find open (non-completed) action items for these meetings
  const openTasks = tasks.filter(t => {
    if (!last3MeetingIds.has(t.meeting_id)) return false;
    const status = (t.status || '').toLowerCase().trim();
    return status !== 'completed';
  });

  if (openTasks.length === 0) {
    return 'Earlier Open Tasks: None pending from the last 3 meetings.';
  }

  let memoryContext = 'Earlier Open Tasks (from the last 3 meetings of this group):\n';
  openTasks.forEach(t => {
    const ownerStr = t.owner || 'Unassigned';
    const tgStr = t.owner_telegram_id ? ` (${t.owner_telegram_id})` : '';
    const deadlineStr = t.deadline || t.deadline_phrase || 'No deadline';
    memoryContext += `- [${t.task_id}] "${t.task}" | Owner: ${ownerStr}${tgStr} | Status: ${t.status} | Deadline: ${deadlineStr}\n`;
  });

  return memoryContext.trim();
}

function processExtractMeetingMemory(items, customMeetings = null, customTasks = null) {
  const results = [];

  for (const item of items) {
    const json = item.json;
    const chatId = json.chat_id;

    let meetings = customMeetings;
    if (!meetings) {
      try {
        if (typeof $ !== 'undefined') {
          meetings = $('Read Meetings Tab').all().map(i => i.json);
        }
      } catch (e) {
        meetings = [];
      }
    }
    meetings = meetings || [];

    let tasks = customTasks;
    if (!tasks) {
      try {
        if (typeof $ !== 'undefined') {
          tasks = $('Read ActionItems Tab (Memory)').all().map(i => i.json);
        }
      } catch (e) {
        tasks = [];
      }
    }
    tasks = tasks || [];

    const memoryContext = extractMeetingMemory(chatId, meetings, tasks);

    results.push({
      json: {
        ...json,
        earlier_tasks_context: memoryContext
      }
    });
  }

  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    extractMeetingMemory,
    processExtractMeetingMemory
  };
}

if (typeof $input !== 'undefined') {
  return processExtractMeetingMemory($input.all());
}
