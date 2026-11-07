/**
 * EDITH Filtered Task Board Formatter (code-nodes/format_tasks_filtered.js)
 * 
 * Implements:
 * 1. /tasks (no args): Lists sender's pending tasks
 * 2. /tasks overdue: Lists all overdue tasks
 * 3. /tasks all: Lists all open tasks grouped by owner
 */

function formatDateIst(ms = Date.now()) {
  const d = new Date(ms + 330 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function processFormatTasksFiltered(items, allTasks = [], triggerData = {}) {
  const results = [];

  const chatId = triggerData.chat_id || '';
  const fromUser = triggerData.from || {};
  const senderUsername = (fromUser.username || '').replace(/^@/, '').trim().toLowerCase();
  const senderName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ').trim().toLowerCase();

  const text = (triggerData.text || triggerData.command_args || '').trim();
  const arg = text.replace(/^\/tasks(?:@\w+)?\s*/i, '').trim().toLowerCase();

  const todayStr = formatDateIst();
  const openTasks = allTasks.filter(t => (t.status || '').toLowerCase() !== 'completed');

  let msg = '';

  // Case 1: /tasks overdue
  if (arg === 'overdue') {
    const overdueTasks = openTasks.filter(t => 
      t.status === 'overdue' || (t.deadline && t.deadline < todayStr)
    );

    if (overdueTasks.length === 0) {
      msg = `✅ **EDITH Tasks: Overdue**\n\nNo overdue action items. All tasks are currently on schedule.`;
    } else {
      msg = `⚠️ **EDITH Tasks: Overdue (${overdueTasks.length} items)**\n\n`;
      overdueTasks.forEach((t, i) => {
        const owner = t.owner_telegram_id || (t.owner ? `@${t.owner}` : 'Unassigned');
        msg += `${i + 1}. ⚠️ **${t.task}** (\`${t.task_id}\`)\n`;
        msg += `   • Assignee: ${owner} | Due: 📅 ${t.deadline} (Overdue)\n`;
        msg += `   • Status: \`${t.status}\`\n\n`;
      });
      msg += `*Update status via: \`/done <task_id>\`.*`;
    }

  // Case 2: /tasks all (Grouped by owner)
  } else if (arg === 'all') {
    if (openTasks.length === 0) {
      msg = `📋 **EDITH Master Task Board**\n\nNo active tasks in EDITH Database. Everything is completed.`;
    } else {
      // Group tasks by owner
      const grouped = {};
      openTasks.forEach(t => {
        const ownerKey = t.owner ? t.owner.trim() : 'Unassigned';
        if (!grouped[ownerKey]) grouped[ownerKey] = [];
        grouped[ownerKey].push(t);
      });

      msg = `📋 **EDITH Master Task Board (${openTasks.length} open tasks)**\n\n`;
      for (const [owner, tasks] of Object.entries(grouped)) {
        const handle = tasks[0].owner_telegram_id ? ` (${tasks[0].owner_telegram_id})` : '';
        msg += `👤 **${owner}**${handle}:\n`;
        tasks.forEach((t, i) => {
          const isOverdue = t.deadline && t.deadline < todayStr;
          const badge = isOverdue ? '⚠️ [OVERDUE]' : (!t.owner ? '⚠️' : '📌');
          const dl = t.deadline ? `📅 ${t.deadline}` : '📅 No deadline';
          msg += `  ${i + 1}. ${badge} **${t.task}** (\`${t.task_id}\`) | ${dl}\n`;
        });
        msg += `\n`;
      }
      msg += `*Update tasks with \`/update <task_id> completed\` or \`/done <task_id>\`.*`;
    }

  // Case 3: /tasks (Sender's pending tasks)
  } else {
    const myTasks = openTasks.filter(t => {
      const taskOwner = (t.owner || '').trim().toLowerCase();
      const taskOwnerTg = (t.owner_telegram_id || '').replace(/^@/, '').trim().toLowerCase();
      if (!taskOwner && !taskOwnerTg) return false;
      return (senderUsername && taskOwnerTg === senderUsername) ||
             (senderName && taskOwner && (taskOwner === senderName || taskOwner.includes(senderName) || senderName.includes(taskOwner)));
    });

    if (myTasks.length === 0) {
      msg = `📋 **Your Assigned Tasks**\n\nNo pending action items assigned to you.\n\n` +
            `• View team overdue tasks: \`/tasks overdue\`\n` +
            `• View all team tasks: \`/tasks all\``;
    } else {
      msg = `📋 **Your Assigned Tasks (${myTasks.length} pending):**\n\n`;
      myTasks.forEach((t, i) => {
        const isOverdue = t.deadline && t.deadline < todayStr;
        const badge = isOverdue ? '⚠️ [OVERDUE]' : '📌';
        const dl = t.deadline ? `📅 ${t.deadline}` : '📅 No deadline';
        msg += `${i + 1}. ${badge} **${t.task}** (\`${t.task_id}\`)\n`;
        msg += `   • Deadline: ${dl} | Status: \`${t.status}\`\n\n`;
      });
      msg += `*Mark complete with: \`/done <task_id>\`.*`;
    }
  }

  results.push({
    json: {
      chat_id: chatId,
      message_text: msg
    }
  });

  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    processFormatTasksFiltered
  };
}

if (typeof $input !== 'undefined') {
  let allTasks = [];
  try {
    if (typeof $ !== 'undefined') {
      allTasks = $('Read ActionItems Tab').all().map(i => i.json);
    }
  } catch (e) {
    allTasks = [];
  }

  let triggerData = {};
  try {
    if (typeof $ !== 'undefined') {
      triggerData = $('Parse Update Action').first()?.json || $('Execute Workflow Trigger').first()?.json || {};
    }
  } catch (e) {
    triggerData = {};
  }

  return processFormatTasksFiltered($input.all(), allTasks, triggerData);
}
