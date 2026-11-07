/**
 * EDITH Task Update & Clarification Action Parser (code-nodes/parse_update_action.js)
 * 
 * Classifies incoming actions into:
 * 1. Active Tasks Board query (/tasks)
 * 2. Inline button callback query (act|<task_id>|<value>)
 * 3. Free-text reply to clarification message
 * 4. Slash commands (/update, /done, /assign, /deadline)
 */

function getIstDate(offsetDays = 0) {
  const istTime = new Date(Date.now() + (330 + offsetDays * 1440) * 60 * 1000);
  return istTime.toISOString().slice(0, 10);
}

function getNextWeekdayIst(targetDayOfWeek) { // 0 = Sun, 1 = Mon, ..., 5 = Fri
  const now = new Date(Date.now() + 330 * 60 * 1000);
  const currentDay = now.getUTCDay();
  let diff = targetDayOfWeek - currentDay;
  if (diff <= 0) diff += 7;
  const targetDate = new Date(now.getTime() + diff * 24 * 60 * 60 * 1000);
  return targetDate.toISOString().slice(0, 10);
}

const VALID_STATUSES = new Set([
  'assigned',
  'missing_deadline',
  'ambiguous_deadline',
  'conflicting_deadline',
  'unassigned',
  'in_progress',
  'completed',
  'overdue'
]);

function processUpdateAction(items) {
  const results = [];

  for (const item of items) {
    const json = item.json;

    let taskId = null;
    let newStatus = null;
    let newOwner = null;
    let newDeadline = null;
    let actionType = 'unknown';
    let isTasksQuery = false;
    let isCallback = false;
    let isClarifyReply = false;
    let isCommand = false;
    let skipAction = false;

    const chatId = json.chat_id;
    const fromUser = json.from || {};
    const userHandle = fromUser.username ? `@${fromUser.username}` : (fromUser.name || 'User');
    const command = (json.command || '').toLowerCase();
    const text = (json.text || json.raw_text || '').trim();
    const args = (json.command_args || '').trim();
    const callbackData = (json.callback_data || '').trim();
    const callbackQueryId = json.callback_query_id || null;

    // Route 1: /tasks query
    if (command === 'tasks' || text === '/tasks' || text.startsWith('/tasks')) {
      isTasksQuery = true;
      actionType = 'tasks_query';
      results.push({
        json: {
          is_tasks_query: true,
          is_callback: false,
          is_clarify_reply: false,
          is_command: true,
          action_type: actionType,
          chat_id: chatId
        }
      });
      continue;
    }

    // Route 2: Inline button callback (act|<task_id>|<value>)
    if (callbackData) {
      isCallback = true;
      actionType = 'callback';
      const parts = callbackData.includes('|') ? callbackData.split('|') : callbackData.split(':');
      const prefix = parts[0]?.toLowerCase();
      taskId = (parts[1] || '').trim().toUpperCase();
      const val = (parts[2] || '').trim();

      if (val === 'skip') {
        skipAction = true;
      } else if (val === 'me') {
        newOwner = userHandle;
      } else if (val.startsWith('u:')) {
        newOwner = val.substring(2).trim();
      } else if (val === 'tomorrow') {
        newDeadline = getIstDate(1);
      } else if (val === 'friday') {
        newDeadline = getNextWeekdayIst(5);
      } else if (val === 'next_week') {
        newDeadline = getNextWeekdayIst(1);
      } else if (val.startsWith('d:')) {
        const rawDate = val.substring(2).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
          newDeadline = rawDate;
        } else if (rawDate === 'tomorrow') {
          newDeadline = getIstDate(1);
        } else if (rawDate === 'friday') {
          newDeadline = getNextWeekdayIst(5);
        } else {
          newDeadline = getIstDate(2);
        }
      } else if (prefix === 'status') {
        newStatus = val.toLowerCase();
      } else if (prefix === 'assign') {
        newOwner = val === 'self' ? userHandle : val;
      } else if (prefix === 'deadline') {
        newDeadline = val;
      }
    }

    // Route 3: Slash Commands
    if (!isCallback) {
      if (command === 'done' || text.startsWith('/done')) {
        isCommand = true;
        actionType = 'command_done';
        const match = text.match(/^\/done(?:@\w+)?\s+(TSK-\w+)/i) || args.match(/^(TSK-\w+)/i);
        if (match) {
          taskId = match[1].toUpperCase();
          newStatus = 'completed';
        }
      } else if (command === 'update' || text.startsWith('/update')) {
        isCommand = true;
        actionType = 'command_update';
        const match = (args || text.replace(/^\/update(?:@\w+)?\s*/i, '')).match(/^(TSK-\w+)\s+([a-zA-Z_]+)/i);
        if (match) {
          taskId = match[1].toUpperCase();
          newStatus = match[2].toLowerCase();
          if (newStatus === 'done') newStatus = 'completed';
        }
      } else if (command === 'assign' || text.startsWith('/assign')) {
        isCommand = true;
        actionType = 'command_assign';
        const match = (args || text.replace(/^\/assign(?:@\w+)?\s*/i, '')).match(/^(TSK-\w+)\s+(.+)/i);
        if (match) {
          taskId = match[1].toUpperCase();
          newOwner = match[2].trim();
        }
      } else if (command === 'deadline' || text.startsWith('/deadline')) {
        isCommand = true;
        actionType = 'command_deadline';
        const match = (args || text.replace(/^\/deadline(?:@\w+)?\s*/i, '')).match(/^(TSK-\w+)\s+(\d{4}-\d{2}-\d{2})/i);
        if (match) {
          taskId = match[1].toUpperCase();
          newDeadline = match[2];
        }
      }
    }

    // Route 4: Free-text reply to a clarification message
    if (!isCallback && !isCommand && (json.route === 'reply' || json.reply_to_text)) {
      const replyText = json.reply_to_text || '';
      const targetMatch = replyText.match(/\b(TSK-\w+)\b/i) || text.match(/\b(TSK-\w+)\b/i);

      if (targetMatch) {
        taskId = targetMatch[1].toUpperCase();
        isClarifyReply = true;
        actionType = 'clarify_reply';
      }
    }

    // Validate new status if present
    if (newStatus && !VALID_STATUSES.has(newStatus)) {
      if (newStatus === 'done') newStatus = 'completed';
      else if (newStatus === 'working' || newStatus === 'progress') newStatus = 'in_progress';
      else newStatus = null;
    }

    results.push({
      json: {
        is_tasks_query: isTasksQuery,
        is_callback: isCallback,
        is_clarify_reply: isClarifyReply,
        is_command: isCommand,
        skip_action: skipAction,
        action_type: actionType,
        callback_query_id: callbackQueryId,
        task_id: taskId,
        new_status: newStatus,
        new_owner: newOwner,
        new_deadline: newDeadline,
        chat_id: chatId,
        user_handle: userHandle,
        reply_text: text,
        reply_to_text: json.reply_to_text || '',
        reference_date: getIstDate(0),
        weekday: new Date(Date.now() + 330 * 60 * 1000).toLocaleDateString('en-US', { weekday: 'long' }),
        is_valid_update: Boolean(taskId && (newStatus || newOwner || newDeadline || isClarifyReply || skipAction))
      }
    });
  }

  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getIstDate,
    getNextWeekdayIst,
    processUpdateAction
  };
}

if (typeof $input !== 'undefined') {
  return processUpdateAction($input.all());
}
