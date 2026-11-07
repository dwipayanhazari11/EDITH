/**
 * EDITH Task Update Row Preparer (code-nodes/prepare_task_update_row.js)
 * 
 * Matches target task in ActionItems tab, applies updates,
 * recomputes status, updates timestamp, and crafts the confirmation message.
 */

function processPrepareUpdateRow(items, actionData = {}, existingTasks = []) {
  const results = [];
  const targetTaskId = (actionData.task_id || '').toUpperCase();
  const chatId = actionData.chat_id;

  if (actionData.skip_action) {
    results.push({
      json: {
        task_found: true,
        skip_action: true,
        chat_id: chatId,
        task_id: targetTaskId,
        confirmation_message: `📌 Clarification skipped for task \`${targetTaskId}\`. No changes made.`
      }
    });
    return results;
  }

  const targetRow = existingTasks.find(t => String(t.task_id || '').toUpperCase() === targetTaskId);

  if (!targetRow) {
    results.push({
      json: {
        task_found: false,
        skip_action: false,
        chat_id: chatId,
        task_id: targetTaskId,
        error_message: `⚠️ Task \`${targetTaskId || 'UNKNOWN'}\` not found in EDITH Database.\n\nPlease check the task ID and try again (e.g., \`/update TSK-1001 completed\`).`
      }
    });
  } else {
    const nowStr = new Date(Date.now() + 330 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

    let updatedOwner = targetRow.owner || '';
    let updatedOwnerTg = targetRow.owner_telegram_id || '';
    let updatedDeadline = targetRow.deadline || '';
    let updatedDeadlinePhrase = targetRow.deadline_phrase || '';
    let updatedStatus = targetRow.status || 'assigned';

    // Apply Owner updates
    if (actionData.new_owner) {
      updatedOwner = actionData.new_owner.replace(/^@/, '');
      updatedOwnerTg = actionData.new_owner.startsWith('@') ? actionData.new_owner : `@${actionData.new_owner}`;
    }

    // Apply Deadline updates
    if (actionData.new_deadline) {
      updatedDeadline = actionData.new_deadline;
      updatedDeadlinePhrase = 'Set via Telegram';
    }

    // Apply Status updates
    if (actionData.new_status) {
      updatedStatus = actionData.new_status;
    } else {
      // Recompute status if owner or deadline changed
      if (!updatedOwner) {
        updatedStatus = 'unassigned';
      } else if (!updatedDeadline) {
        updatedStatus = 'missing_deadline';
      } else if (updatedStatus === 'unassigned' || updatedStatus === 'missing_deadline' || updatedStatus === 'ambiguous_deadline' || updatedStatus === 'conflicting_deadline') {
        updatedStatus = 'assigned';
      }
    }

    const updatedRecord = {
      ...targetRow,
      owner: updatedOwner,
      owner_telegram_id: updatedOwnerTg,
      deadline: updatedDeadline,
      deadline_phrase: updatedDeadlinePhrase,
      status: updatedStatus,
      updated_at: nowStr
    };

    const confirmationMsg = `✅ **Task Updated: ${targetTaskId}**\n\n` +
      `• **Task:** ${targetRow.task}\n` +
      `• **Status:** \`${updatedStatus}\`\n` +
      `• **Assignee:** ${updatedOwnerTg || 'Unassigned'}\n` +
      `• **Deadline:** ${updatedDeadline ? `📅 ${updatedDeadline}` : 'No deadline'}\n\n` +
      `*Changes synced to EDITH Database.*`;

    results.push({
      json: {
        task_found: true,
        skip_action: false,
        chat_id: chatId,
        task_id: targetTaskId,
        confirmation_message: confirmationMsg,
        updated_row: updatedRecord
      }
    });
  }

  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    processPrepareUpdateRow
  };
}

if (typeof $input !== 'undefined') {
  let actionData = {};
  try {
    const clarifyResolved = $('Validate Clarification Response').first()?.json;
    if (clarifyResolved && clarifyResolved.is_valid) {
      actionData = clarifyResolved;
    }
  } catch (e) {}

  if (!actionData.task_id) {
    try {
      actionData = $('Parse Update Action').first()?.json || {};
    } catch (e) {}
  }

  let existingTasks = [];
  try {
    existingTasks = $('Read ActionItems Tab').all().map(i => i.json);
  } catch (e) {
    existingTasks = [];
  }

  return processPrepareUpdateRow($input.all(), actionData, existingTasks);
}
