/**
 * EDITH Progress Update & Natural Language Matcher (code-nodes/parse_progress_update.js)
 * 
 * Evaluates progress updates from:
 * 1. Reminder callback buttons (rem|<task_id>|completed | in_progress | more_time)
 * 2. Natural language AI progress match results
 */

function processProgressUpdate(items, existingTasks = []) {
  const results = [];

  for (const item of items) {
    const json = item.json;

    const chatId = json.chat_id;
    const callbackData = (json.callback_data || '').trim();
    const callbackQueryId = json.callback_query_id || null;

    // Case 1: Reminder Inline Button Callback (rem|<task_id>|<value>)
    if (callbackData.startsWith('rem|')) {
      const parts = callbackData.split('|');
      const taskId = (parts[1] || '').trim().toUpperCase();
      const val = (parts[2] || '').trim().toLowerCase();

      if (val === 'more_time') {
        const keyboard = [
          [
            { text: 'Tomorrow', callback_data: `act|${taskId}|tomorrow` },
            { text: 'This Friday', callback_data: `act|${taskId}|friday` }
          ],
          [
            { text: 'Next week', callback_data: `act|${taskId}|next_week` },
            { text: 'Skip', callback_data: `act|${taskId}|skip` }
          ]
        ];

        results.push({
          json: {
            action_type: 'reminder_more_time',
            callback_query_id: callbackQueryId,
            chat_id: chatId,
            task_id: taskId,
            needs_deadline_picker: true,
            message: `Select an updated target deadline for task \`${taskId}\`:`,
            reply_markup: { inline_keyboard: keyboard }
          }
        });
        continue;
      }

      let newStatus = val;
      if (newStatus === 'done') newStatus = 'completed';

      results.push({
        json: {
          action_type: 'reminder_callback',
          callback_query_id: callbackQueryId,
          chat_id: chatId,
          task_id: taskId,
          new_status: newStatus,
          is_valid_update: true
        }
      });
      continue;
    }

    // Case 2: Natural Language AI Match Result
    let matchResult = json.match_result || json.data || json;
    try {
      if (typeof matchResult === 'string') matchResult = JSON.parse(matchResult);
    } catch (e) {}

    const matchedTaskId = (matchResult.matched_task_id || '').trim().toUpperCase();
    const newStatus = matchResult.new_status || 'completed';
    const confidence = typeof matchResult.confidence === 'number' ? matchResult.confidence : 0;
    const candidateTaskIds = Array.isArray(matchResult.candidate_task_ids) ? matchResult.candidate_task_ids : [];

    // Subcase 2A: High-confidence single match
    if (matchedTaskId && confidence >= 0.85) {
      results.push({
        json: {
          action_type: 'nl_match_single',
          chat_id: chatId,
          task_id: matchedTaskId,
          new_status: newStatus,
          confidence: confidence,
          is_valid_update: true
        }
      });
      continue;
    }

    // Subcase 2B: Ambiguous match with multiple candidates
    if (candidateTaskIds.length > 1 || (candidateTaskIds.length === 1 && confidence < 0.85)) {
      const candidateButtons = [];
      for (const cid of candidateTaskIds.slice(0, 4)) {
        const matched = existingTasks.find(t => String(t.task_id).toUpperCase() === cid.toUpperCase());
        const label = matched ? `${matched.task.substring(0, 20)} (${cid})` : cid;
        candidateButtons.push([{ text: label, callback_data: `act|${cid}|${newStatus}` }]);
      }
      candidateButtons.push([{ text: 'Cancel', callback_data: `act|none|skip` }]);

      results.push({
        json: {
          action_type: 'nl_match_ambiguous',
          chat_id: chatId,
          is_ambiguous: true,
          message: 'Which task did you mean?',
          reply_markup: { inline_keyboard: candidateButtons }
        }
      });
      continue;
    }

    // Subcase 2C: No match found
    results.push({
      json: {
        action_type: 'nl_match_none',
        chat_id: chatId,
        is_valid_update: false,
        message: 'EDITH could not match your update to an open task. Please use `/update <TASK_ID> completed`.'
      }
    });
  }

  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    processProgressUpdate
  };
}

if (typeof $input !== 'undefined') {
  let existingTasks = [];
  try {
    if (typeof $ !== 'undefined') {
      existingTasks = $('Read ActionItems Tab').all().map(i => i.json);
    }
  } catch (e) {
    existingTasks = [];
  }
  return processProgressUpdate($input.all(), existingTasks);
}
