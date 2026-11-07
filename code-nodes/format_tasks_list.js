/**
 * EDITH Active Tasks Board Formatter
 * 
 * Formats the response for the /tasks command by querying active action items.
 * Adheres strictly to the EDITH persona (calm, sharp, status badges).
 */

const items = $input.all();
const results = [];

const parsedAction = $('Parse Update Action').first()?.json || {};
const chatId = parsedAction.chat_id;

// Historical rows from Read ActionItems Tab node
let allTasks = [];
try {
  allTasks = $('Read ActionItems Tab').all().map(i => i.json);
} catch (e) {
  allTasks = [];
}

const todayStr = new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);

// Filter out completed items
const activeTasks = allTasks.filter(t => (t.status || '').toLowerCase() !== 'completed');

if (activeTasks.length === 0) {
  results.push({
    json: {
      chat_id: chatId,
      message_text: `📋 **Active Tasks Board**\n\nNo pending action items in EDITH Database. All tasks are marked completed.`
    }
  });
} else {
  let overdueCount = 0;
  let unassignedCount = 0;

  let msg = `📋 **Active Tasks Board (${activeTasks.length} pending):**\n\n`;

  activeTasks.forEach((t, idx) => {
    const isOverdue = t.deadline && t.deadline < todayStr;
    if (isOverdue) overdueCount++;

    const isUnassigned = !t.owner || t.status === 'unassigned';
    if (isUnassigned) unassignedCount++;

    let badge = '✅';
    if (isOverdue) badge = '⚠️ [OVERDUE]';
    else if (isUnassigned) badge = '⚠️ [UNASSIGNED]';
    else if (t.status === 'in_progress') badge = '🔄';
    else if (t.status === 'ambiguous_deadline' || t.status === 'missing_deadline') badge = '⚠️';

    const ownerDisplay = t.owner_telegram_id || (t.owner ? `@${t.owner}` : 'Unassigned');
    const deadlineDisplay = t.deadline ? `📅 ${t.deadline}` : (t.deadline_phrase ? `📅 Ambiguous ("${t.deadline_phrase}")` : '📅 No deadline');

    msg += `${idx + 1}. ${badge} **${t.task}** (\`${t.task_id}\`)\n`;
    msg += `   • Assignee: ${ownerDisplay} | Deadline: ${deadlineDisplay}\n`;
    msg += `   • Status: \`${t.status}\`\n\n`;
  });

  msg += `*Summary: ${activeTasks.length} open, ${overdueCount} overdue, ${unassignedCount} unassigned.*\n`;
  msg += `*Update status via: \`/update <task_id> <status>\` or \`/done <task_id>.*`;

  results.push({
    json: {
      chat_id: chatId,
      message_text: msg
    }
  });
}

return results;
