/**
 * EDITH Staged Reminder Engine (code-nodes/evaluate_staged_reminders.js)
 * 
 * Rules:
 * 1. Reads ActionItems where status !== 'completed' and deadline is set.
 * 2. Computes stage in Asia/Kolkata:
 *    - Stage 1: T-2 days (deadline === today + 2)
 *    - Stage 2: T-1 day (deadline === today + 1 / tomorrow)
 *    - Stage 3: Due today (deadline === today)
 *    - Stage 4: Overdue (deadline < today)
 * 3. Skips if last_reminder_stage >= current_stage (prevents duplicate spam).
 * 4. Generates personal reminder:
 *    "{Owner}, your \"{task}\" deadline is {time}. Current progress?"
 *    Buttons: "Done", "In progress", "Need more time"
 *    callback_data: rem|<task_id>|<value> (< 64 bytes)
 * 5. Routing:
 *    - DM member.chat_id if registered in Members
 *    - Otherwise @mention in group_chat_id
 * 6. Escalates last_reminder_stage and sets status="overdue" if past due.
 */

function formatDateIst(ms) {
  const d = new Date(ms + 330 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function processStagedReminders(items, customTasks = null, customMembers = null, customConfig = null, customNowMs = null) {
  const results = [];

  const baseMs = customNowMs !== null ? customNowMs : Date.now();
  const todayStr = formatDateIst(baseMs);
  const tMinus1Str = formatDateIst(baseMs + 24 * 60 * 60 * 1000); // tomorrow
  const tMinus2Str = formatDateIst(baseMs + 48 * 60 * 60 * 1000); // in 2 days
  const nowIso = new Date(baseMs + 330 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  // 1. Resolve Config
  let configMap = {};
  if (customConfig) {
    configMap = customConfig;
  } else {
    try {
      if (typeof $ !== 'undefined') {
        const rows = $('Read Config Tab').all().map(i => i.json);
        rows.forEach(r => { if (r.key) configMap[r.key] = String(r.value || '').trim(); });
      }
    } catch (e) {}
  }

  const remindersEnabled = configMap.staged_reminders_enabled !== 'false';
  const groupChatId = configMap.group_chat_id || (typeof process !== 'undefined' ? (process.env.TELEGRAM_GROUP_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID) : null);

  if (!remindersEnabled) {
    results.push({ json: { has_reminders: false, reason: 'reminders_disabled' } });
    return results;
  }

  // 2. Resolve Members
  let membersList = customMembers;
  if (!membersList) {
    try {
      if (typeof $ !== 'undefined') {
        membersList = $('Read Members Tab').all().map(i => i.json);
      }
    } catch (e) {
      membersList = [];
    }
  }
  membersList = membersList || [];

  // 3. Resolve Tasks
  let allTasks = customTasks;
  if (!allTasks) {
    try {
      if (typeof $ !== 'undefined') {
        allTasks = $('Read ActionItems Tab').all().map(i => i.json);
      }
    } catch (e) {
      allTasks = [];
    }
  }
  allTasks = allTasks || [];

  const reminderMessages = [];
  const tasksToUpdate = [];

  for (const task of allTasks) {
    const status = (task.status || '').toLowerCase().trim();
    if (status === 'completed') continue;

    const deadline = (task.deadline || '').trim();
    if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) continue;

    const lastStage = parseInt(task.last_reminder_stage, 10) || 0;
    let currentStage = 0;
    let timePhrase = '';

    if (deadline < todayStr) {
      currentStage = 4; // Overdue
      timePhrase = 'past due';
    } else if (deadline === todayStr) {
      currentStage = 3; // Due today
      timePhrase = 'today';
    } else if (deadline === tMinus1Str) {
      currentStage = 2; // T-1 day (tomorrow)
      timePhrase = 'tomorrow';
    } else if (deadline === tMinus2Str) {
      currentStage = 1; // T-2 days
      timePhrase = 'in 2 days';
    }

    // Skip if not in a reminder window or already reminded for this stage (anti-spam)
    if (currentStage === 0 || lastStage >= currentStage) {
      continue;
    }

    // Lookup Member registration
    const taskOwner = (task.owner || '').trim();
    const taskOwnerTg = (task.owner_telegram_id || '').replace(/^@/, '').trim().toLowerCase();

    let matchedMember = membersList.find(m => 
      (taskOwnerTg && (m.telegram_username || '').replace(/^@/, '').trim().toLowerCase() === taskOwnerTg) ||
      (taskOwner && (m.name || '').trim().toLowerCase() === taskOwner.toLowerCase()) ||
      (taskOwner && (m.name || '').trim().split(' ')[0].toLowerCase() === taskOwner.split(' ')[0].toLowerCase())
    );

    const ownerName = matchedMember?.name || task.owner || 'Team member';
    const hasDmChat = matchedMember?.chat_id && !String(matchedMember.chat_id).startsWith('-');
    const targetChatId = hasDmChat ? String(matchedMember.chat_id) : groupChatId;

    let reminderText = '';
    if (hasDmChat) {
      // Sent directly via DM
      reminderText = `${ownerName}, your "${task.task}" deadline is ${timePhrase}. Current progress?`;
    } else {
      // Sent to group chat with @mention
      const mention = matchedMember?.telegram_username ? `@${matchedMember.telegram_username}` : (task.owner_telegram_id || ownerName);
      reminderText = `${mention} ${ownerName}, your "${task.task}" deadline is ${timePhrase}. Current progress?`;
    }

    const inlineKeyboard = [
      [
        { text: 'Done', callback_data: `rem|${task.task_id}|completed` },
        { text: 'In progress', callback_data: `rem|${task.task_id}|in_progress` },
        { text: 'Need more time', callback_data: `rem|${task.task_id}|more_time` }
      ]
    ];

    reminderMessages.push({
      chat_id: targetChatId,
      task_id: task.task_id,
      text: reminderText,
      reply_markup: {
        inline_keyboard: inlineKeyboard
      }
    });

    const newStatus = currentStage === 4 ? 'overdue' : (task.status || 'assigned');
    tasksToUpdate.push({
      ...task,
      last_reminder_stage: currentStage,
      status: newStatus,
      updated_at: nowIso
    });
  }

  results.push({
    json: {
      has_reminders: reminderMessages.length > 0,
      total_reminders: reminderMessages.length,
      reminder_dispatches: reminderMessages,
      tasks_to_update: tasksToUpdate
    }
  });

  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatDateIst,
    processStagedReminders
  };
}

if (typeof $input !== 'undefined') {
  return processStagedReminders($input.all());
}
