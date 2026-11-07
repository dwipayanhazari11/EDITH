/**
 * EDITH Telegram Summary & Clarification Formatter (code-nodes/format_summary.js)
 * 
 * Rules:
 * 1. Formats Telegram HTML message:
 *    - header: "EDITH MEETING REPORT" with meeting title and date
 *    - Key Decisions (mark unconfirmed ones as "suggested")
 *    - Action Items: numbered, owner, task, deadline (e.g., "Fri, 13 Nov 2026"), status badge
 *    - Open Questions
 *    - Clarifications Required list
 *    - footer: "Logged by EDITH | <meeting_id>"
 * 2. Strict HTML escaping of all user-supplied text
 * 3. Splits into multiple messages if over 4096 characters, at section boundaries
 * 4. Resolves group_chat_id from Config tab (fallback to trigger chat_id)
 * 5. Prepares separate clarification messages for each incomplete task with inline keyboards:
 *    - callback_data: "act|<task_id>|<value>" strictly < 64 bytes
 */

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateDisplay(isoStr) {
  if (!isoStr || !/^\d{4}-\d{2}-\d{2}$/.test(isoStr)) return null;
  try {
    const parts = isoStr.split('-');
    const date = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dayName = days[date.getUTCDay()];
    const day = date.getUTCDate();
    const monName = months[date.getUTCMonth()];
    const year = date.getUTCFullYear();
    return `${dayName}, ${day} ${monName} ${year}`;
  } catch (e) {
    return isoStr;
  }
}

function splitHtmlMessage(fullHtml, maxLength = 4000) {
  if (fullHtml.length <= maxLength) return [fullHtml];

  const sections = fullHtml.split('\n\n');
  const chunks = [];
  let currentChunk = '';

  for (const sec of sections) {
    if (!currentChunk) {
      currentChunk = sec;
    } else if ((currentChunk + '\n\n' + sec).length <= maxLength) {
      currentChunk += '\n\n' + sec;
    } else {
      chunks.push(currentChunk);
      currentChunk = sec;
    }
  }
  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

// Retrieve members and config from previous nodes (if available in n8n execution context)
let membersList = [];
try {
  if (typeof $ !== 'undefined') {
    membersList = $('Read Members Tab').all().map(i => i.json);
  }
} catch (e) {
  membersList = [];
}

let configList = [];
try {
  if (typeof $ !== 'undefined') {
    configList = $('Read Config Tab').all().map(i => i.json);
  }
} catch (e) {
  configList = [];
}

function processFormatSummary(items, members = membersList, config = configList) {
  const results = [];

  for (const item of items) {
    const json = item.json;

    const payload = json.meeting_row ? json : (json.payload || json);
    const meetingRow = payload.meeting_row || {};
    const actionItems = payload.action_items_rows || [];
    const openQuestions = payload.open_questions_rows || [];
    const meetingId = payload.meeting_id || meetingRow.meeting_id || 'MTG-UNKNOWN';
    const meetingDate = meetingRow.meeting_date || json.meeting_date || 'Date Unspecified';
    const meetingTitle = meetingRow.title || json.meeting_title || 'Untitled Meeting';

    // 1. Resolve Target Chat ID
    const configRow = config.find(c => (c.key || '').trim().toLowerCase() === 'group_chat_id');
    const groupChatId = (configRow?.value || '').trim();
    const targetChatId = groupChatId || String(json.chat_id || payload.chat_id || '');

    // 2. Parse Decisions & Key Points
    let decisions = [];
    if (json.analysis?.decisions) {
      decisions = json.analysis.decisions;
    } else if (meetingRow.decisions) {
      decisions = meetingRow.decisions.split('\n').filter(Boolean).map(line => {
        const isConfirmed = line.includes('✅');
        const text = line.replace(/^[✅⚠️•\s]+/, '').replace(/\(suggested\)/i, '').trim();
        return { text, confirmed: isConfirmed };
      });
    }

    // 3. Assemble HTML Summary
    let summaryHtml = `<b>EDITH MEETING REPORT</b>\n`;
    summaryHtml += `<b>Title:</b> ${escapeHtml(meetingTitle)}\n`;
    summaryHtml += `<b>Date:</b> ${escapeHtml(meetingDate)}\n\n`;

    if (decisions.length > 0) {
      summaryHtml += `<b>Key Decisions:</b>\n`;
      for (const d of decisions) {
        const label = d.confirmed ? '' : ' <i>(suggested)</i>';
        summaryHtml += `• ${escapeHtml(d.text)}${label}\n`;
      }
      summaryHtml += `\n`;
    }

    summaryHtml += `<b>Action Items (${actionItems.length} logged):</b>\n`;
    const incompleteItems = [];

    if (actionItems.length === 0) {
      summaryHtml += `No discrete action items recorded.\n\n`;
    } else {
      actionItems.forEach((act, idx) => {
        const isIncomplete = ['unassigned', 'missing_deadline', 'ambiguous_deadline', 'conflicting_deadline'].includes(act.status);
        if (isIncomplete) incompleteItems.push(act);

        const statusBadge = isIncomplete ? '⚠️' : (act.status === 'completed' ? '✅' : '📌');
        const ownerDisplay = act.owner_telegram_id || (act.owner ? `@${escapeHtml(act.owner)}` : '<i>Unassigned</i>');
        const formattedDate = formatDateDisplay(act.deadline);
        const deadlineDisplay = formattedDate ? formattedDate : (act.deadline_phrase ? `Ambiguous ("${escapeHtml(act.deadline_phrase)}")` : '<i>No deadline</i>');

        summaryHtml += `${idx + 1}. ${statusBadge} <b>${escapeHtml(act.task)}</b>\n`;
        summaryHtml += `   • Assignee: ${ownerDisplay}\n`;
        summaryHtml += `   • Deadline: 📅 ${deadlineDisplay}\n`;
        summaryHtml += `   • Status: <code>${escapeHtml(act.status)}</code>\n`;
      });
      summaryHtml += `\n`;
    }

    if (openQuestions.length > 0) {
      summaryHtml += `<b>Open Questions:</b>\n`;
      openQuestions.forEach(q => {
        const resp = q.responsible_person ? ` (Lead: ${escapeHtml(q.responsible_person)})` : '';
        summaryHtml += `• ❓ ${escapeHtml(q.question)}${resp}\n`;
      });
      summaryHtml += `\n`;
    }

    // Phase 10: Updates to earlier tasks (Meeting Memory)
    const updatesToEarlier = payload.updates_to_existing_tasks || json.analysis?.updates_to_existing_tasks || [];
    if (updatesToEarlier.length > 0) {
      summaryHtml += `<b>Updates to earlier tasks:</b>\n`;
      updatesToEarlier.forEach(u => {
        const changeBadge = u.change === 'completed' ? '✅' : '🔄';
        const evidenceStr = u.evidence ? ` <i>("${escapeHtml(u.evidence)}")</i>` : '';
        summaryHtml += `• ${changeBadge} <code>${escapeHtml(u.existing_task_id)}</code> — Marked <code>${escapeHtml(u.change)}</code>${evidenceStr}\n`;
      });
      summaryHtml += `\n`;
    }

    if (incompleteItems.length > 0) {
      summaryHtml += `<b>Clarifications Required:</b>\n`;
      incompleteItems.forEach(item => {
        let reason = 'Incomplete details';
        if (item.status === 'unassigned') reason = 'Owner unassigned';
        else if (item.status === 'missing_deadline') reason = 'Missing deadline';
        else if (item.status === 'ambiguous_deadline') reason = `Ambiguous deadline ("${item.deadline_phrase}")`;
        else if (item.status === 'conflicting_deadline') reason = `Conflicting deadline ("${item.deadline_phrase}")`;

        summaryHtml += `• ⚠️ <b>${escapeHtml(item.task)}</b> (<code>${item.task_id}</code>) — ${reason}\n`;
      });
      summaryHtml += `\n`;
    }

    summaryHtml += `Logged by EDITH | <code>${meetingId}</code>`;

    // 4. Split HTML message if > 4096 characters
    const summaryMessages = splitHtmlMessage(summaryHtml, 4000);

    // 5. Build Individual Clarification Messages with Inline Buttons (< 64 bytes)
    const clarificationDispatches = [];

    for (const item of incompleteItems) {
      const taskId = item.task_id;
      let clarifyText = '';
      const inlineKeyboard = [];

      if (item.status === 'unassigned') {
        clarifyText = `⚠️ <b>Incomplete assignment detected.</b>\n\n` +
          `<b>Task:</b> ${escapeHtml(item.task)}\n` +
          `<b>ID:</b> <code>${taskId}</code>\n\n` +
          `No owner identified. Who will take this?`;

        // Button: Assign to me (callback_data: act|TSK-XXXXXX|me)
        const row1 = [{ text: 'Assign to me', callback_data: `act|${taskId}|me` }];

        // Up to 4 Member Name Buttons
        const memberButtons = [];
        const eligibleMembers = members.filter(m => m.name || m.telegram_username).slice(0, 4);
        for (const m of eligibleMembers) {
          const displayName = m.name || m.telegram_username;
          const valueId = (m.telegram_username ? `@${m.telegram_username}` : m.name).substring(0, 20);
          memberButtons.push({
            text: displayName.substring(0, 16),
            callback_data: `act|${taskId}|u:${valueId}`
          });
        }

        const rows = [row1];
        if (memberButtons.length > 0) {
          for (let i = 0; i < memberButtons.length; i += 2) {
            rows.push(memberButtons.slice(i, i + 2));
          }
        }
        rows.push([{ text: 'Skip', callback_data: `act|${taskId}|skip` }]);
        inlineKeyboard.push(...rows);

      } else if (item.status === 'missing_deadline' || item.status === 'ambiguous_deadline') {
        const ownerDisplay = item.owner_telegram_id || (item.owner ? `@${item.owner}` : 'Unassigned');
        clarifyText = `⚠️ <b>Incomplete deadline detected.</b>\n\n` +
          `<b>Task:</b> ${escapeHtml(item.task)}\n` +
          `<b>ID:</b> <code>${taskId}</code>\n` +
          `<b>Assignee:</b> ${ownerDisplay}\n` +
          (item.status === 'ambiguous_deadline' ? `<b>Stated phrase:</b> "<i>${escapeHtml(item.deadline_phrase)}</i>"\n\n` : `\n`) +
          `No concrete target date was specified. When is this due?`;

        inlineKeyboard.push([
          { text: 'Tomorrow', callback_data: `act|${taskId}|tomorrow` },
          { text: 'This Friday', callback_data: `act|${taskId}|friday` }
        ]);
        inlineKeyboard.push([
          { text: 'Next week', callback_data: `act|${taskId}|next_week` },
          { text: 'Skip', callback_data: `act|${taskId}|skip` }
        ]);

      } else if (item.status === 'conflicting_deadline') {
        const ownerDisplay = item.owner_telegram_id || (item.owner ? `@${item.owner}` : 'Unassigned');
        clarifyText = `⚠️ <b>Conflicting deadlines detected.</b>\n\n` +
          `<b>Task:</b> ${escapeHtml(item.task)}\n` +
          `<b>ID:</b> <code>${taskId}</code>\n` +
          `<b>Assignee:</b> ${ownerDisplay}\n` +
          `<b>Proposed dates:</b> <i>${escapeHtml(item.deadline_phrase)}</i>\n\n` +
          `Which target date is correct?`;

        const parts = (item.deadline_phrase || '').split(/(?:vs|or|and|\/|,)/i).map(p => p.trim()).filter(Boolean);
        const conflictButtons = [];
        parts.slice(0, 3).forEach((p, idx) => {
          const cleanVal = p.toLowerCase().replace(/[^a-z0-9_-]/g, '').substring(0, 16) || `opt${idx + 1}`;
          conflictButtons.push({
            text: p.substring(0, 16),
            callback_data: `act|${taskId}|d:${cleanVal}`
          });
        });

        if (conflictButtons.length > 0) {
          inlineKeyboard.push(conflictButtons);
        } else {
          inlineKeyboard.push([
            { text: 'Tomorrow', callback_data: `act|${taskId}|tomorrow` },
            { text: 'This Friday', callback_data: `act|${taskId}|friday` }
          ]);
        }
        inlineKeyboard.push([{ text: 'Skip', callback_data: `act|${taskId}|skip` }]);
      }

      clarificationDispatches.push({
        chat_id: targetChatId,
        task_id: taskId,
        text: clarifyText,
        reply_markup: {
          inline_keyboard: inlineKeyboard
        }
      });
    }

    results.push({
      json: {
        target_chat_id: targetChatId,
        meeting_id: meetingId,
        summary_messages: summaryMessages,
        summary_html: summaryMessages[0],
        additional_summary_messages: summaryMessages.slice(1),
        has_multiple_summary_messages: summaryMessages.length > 1,
        clarification_dispatches: clarificationDispatches,
        has_clarifications: clarificationDispatches.length > 0
      }
    });
  }

  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeHtml,
    formatDateDisplay,
    splitHtmlMessage,
    processFormatSummary
  };
}

if (typeof $input !== 'undefined') {
  return processFormatSummary($input.all());
}
