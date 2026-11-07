/**
 * EDITH Staged Reminder Evaluator (code-nodes/evaluate_reminders.js)
 * 
 * Evaluates pending action items against current IST date (Asia/Kolkata).
 * Classifies items into 3 escalation stages:
 * - Stage 1: Due Tomorrow (T-24h) and last_reminder_stage < 1
 * - Stage 2: Due Today and last_reminder_stage < 2
 * - Stage 3: Overdue (deadline < today) and last_reminder_stage < 3
 * 
 * Prevents spam by checking and updating last_reminder_stage.
 */

function processEvaluateReminders(items, customTasks = null, customConfig = null, customNowMs = null) {
  const results = [];

  // 1. Calculate IST Dates (Asia/Kolkata, UTC+5:30)
  const nowMs = customNowMs !== null ? customNowMs : (Date.now() + 330 * 60 * 1000);
  const todayObj = new Date(nowMs);
  const todayStr = todayObj.toISOString().slice(0, 10);

  const tomorrowObj = new Date(nowMs + 24 * 60 * 60 * 1000);
  const tomorrowStr = tomorrowObj.toISOString().slice(0, 10);

  const nowStr = todayObj.toISOString().replace('T', ' ').slice(0, 19);

  // 2. Retrieve Config Settings
  let configMap = {};
  if (customConfig) {
    configMap = customConfig;
  } else {
    try {
      if (typeof $ !== 'undefined') {
        const configRows = $('Read Config Tab').all().map(i => i.json);
        for (const row of configRows) {
          if (row.key) configMap[row.key] = String(row.value || '').trim();
        }
      }
    } catch (e) {
      configMap = {};
    }
  }

  const remindersEnabled = configMap.staged_reminders_enabled !== 'false';
  const targetChatId = configMap.group_chat_id || (typeof process !== 'undefined' ? (process.env.TELEGRAM_GROUP_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID) : null);

  if (!remindersEnabled || !targetChatId) {
    results.push({
      json: {
        has_reminders: false,
        reason: !remindersEnabled ? 'staged_reminders_disabled' : 'missing_group_chat_id'
      }
    });
    return results;
  }

  // 3. Retrieve Tasks from Read ActionItems Tab
  let allTasks = [];
  if (customTasks) {
    allTasks = customTasks;
  } else {
    try {
      if (typeof $ !== 'undefined') {
        allTasks = $('Read ActionItems Tab').all().map(i => i.json);
      }
    } catch (e) {
      allTasks = [];
    }
  }

  const stage1Tasks = []; // Due Tomorrow
  const stage2Tasks = []; // Due Today
  const stage3Tasks = []; // Overdue
  const tasksToUpdate = [];

  for (const t of allTasks) {
    const status = (t.status || '').toLowerCase();
    if (status === 'completed') continue;

    const deadline = (t.deadline || '').trim();
    if (!deadline) continue;

    const lastStage = parseInt(t.last_reminder_stage, 10) || 0;

    if (deadline < todayStr && lastStage < 3) {
      // Stage 3: Overdue
      stage3Tasks.push(t);
      tasksToUpdate.push({
        ...t,
        last_reminder_stage: 3,
        status: 'overdue',
        updated_at: nowStr
      });
    } else if (deadline === todayStr && lastStage < 2) {
      // Stage 2: Due Today
      stage2Tasks.push(t);
      tasksToUpdate.push({
        ...t,
        last_reminder_stage: 2,
        updated_at: nowStr
      });
    } else if (deadline === tomorrowStr && lastStage < 1) {
      // Stage 1: Due Tomorrow
      stage1Tasks.push(t);
      tasksToUpdate.push({
        ...t,
        last_reminder_stage: 1,
        updated_at: nowStr
      });
    }
  }

  const totalReminders = stage1Tasks.length + stage2Tasks.length + stage3Tasks.length;

  if (totalReminders === 0) {
    results.push({
      json: {
        has_reminders: false,
        chat_id: targetChatId,
        message_text: ''
      }
    });
    return results;
  }

  // 4. Construct Formatted Telegram Reminder Digest in EDITH Persona
  let msg = `📌 **EDITH Daily Follow-up (${todayStr})**\n\n`;

  if (stage3Tasks.length > 0) {
    msg += `⚠️ **Overdue Action Items (${stage3Tasks.length}):**\n`;
    stage3Tasks.forEach((t, i) => {
      const owner = t.owner_telegram_id || (t.owner ? `@${t.owner}` : 'Unassigned');
      msg += `${i + 1}. **${t.task}** (\`${t.task_id}\`)\n`;
      msg += `   • Assignee: ${owner} | Due: 📅 ${t.deadline} (Overdue)\n`;
    });
    msg += `\n`;
  }

  if (stage2Tasks.length > 0) {
    msg += `⏳ **Due Today (${stage2Tasks.length}):**\n`;
    stage2Tasks.forEach((t, i) => {
      const owner = t.owner_telegram_id || (t.owner ? `@${t.owner}` : 'Unassigned');
      msg += `${i + 1}. **${t.task}** (\`${t.task_id}\`)\n`;
      msg += `   • Assignee: ${owner} | Due: 📅 Today\n`;
    });
    msg += `\n`;
  }

  if (stage1Tasks.length > 0) {
    msg += `📅 **Due Tomorrow (${stage1Tasks.length}):**\n`;
    stage1Tasks.forEach((t, i) => {
      const owner = t.owner_telegram_id || (t.owner ? `@${t.owner}` : 'Unassigned');
      msg += `${i + 1}. **${t.task}** (\`${t.task_id}\`)\n`;
      msg += `   • Assignee: ${owner} | Due: 📅 Tomorrow (${t.deadline})\n`;
    });
    msg += `\n`;
  }

  msg += `*Mark complete in Google Sheets or reply with: \`/done <task_id>\`.*`;

  results.push({
    json: {
      has_reminders: true,
      chat_id: targetChatId,
      message_text: msg,
      total_reminders: totalReminders,
      tasks_to_update: tasksToUpdate
    }
  });

  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    processEvaluateReminders
  };
}

if (typeof $input !== 'undefined') {
  return processEvaluateReminders($input.all());
}
