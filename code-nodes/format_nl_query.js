/**
 * EDITH NL Query Context Preparer & Grounded Engine (code-nodes/format_nl_query.js)
 * 
 * Aggregates Meetings, ActionItems, and OpenQuestions tabs into a concise,
 * grounded context window for the Gemini AI Agent / generateContent node.
 * 
 * Supports:
 * - "What are my pending tasks?" (Resolves sender identity)
 * - "Which tasks are overdue?"
 * - "Show Priya's responsibilities"
 * - "What did we decide in the last meeting?"
 * - "Is the frontend ready?"
 * - Unknown questions -> "I could not find that in the records."
 */

function processFormatNlQuery(items, customMeetings = null, customTasks = null, customQuestions = null, customTrigger = null) {
  const results = [];

  let triggerData = customTrigger;
  if (!triggerData) {
    try {
      if (typeof $ !== 'undefined') {
        triggerData = $('Execute Workflow Trigger').first()?.json || {};
      }
    } catch (e) {
      triggerData = {};
    }
  }
  triggerData = triggerData || {};

  const userQuery = (triggerData.query || triggerData.command_args || triggerData.text || '').replace(/^\/ask(?:@\w+)?\s*/i, '').trim();
  const chatId = triggerData.chat_id;
  const fromUser = triggerData.from || {};
  const senderName = fromUser.name || [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ') || fromUser.username || 'User';
  const senderTg = fromUser.username ? `@${fromUser.username}` : '';

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
        tasks = $('Read ActionItems Tab').all().map(i => i.json);
      }
    } catch (e) {
      tasks = [];
    }
  }
  tasks = tasks || [];

  let questions = customQuestions;
  if (!questions) {
    try {
      if (typeof $ !== 'undefined') {
        questions = $('Read OpenQuestions Tab').all().map(i => i.json);
      }
    } catch (e) {
      questions = [];
    }
  }
  questions = questions || [];

  const todayStr = new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);

  // 1. Format Meetings Context
  let meetingsContext = '--- MEETINGS ---\n';
  if (meetings.length === 0) {
    meetingsContext += 'No meetings recorded.\n';
  } else {
    // Sort meetings descending by date/id
    const sortedMeetings = [...meetings].sort((a, b) => String(b.meeting_date || '').localeCompare(String(a.meeting_date || '')));
    sortedMeetings.forEach(m => {
      meetingsContext += `[${m.meeting_id}] "${m.title}" (Date: ${m.meeting_date})\n`;
      meetingsContext += `Summary: ${m.summary || 'None'}\n`;
      if (m.decisions) meetingsContext += `Decisions:\n${m.decisions}\n`;
      meetingsContext += '\n';
    });
  }

  // 2. Format Action Items Context
  let tasksContext = '--- ACTION ITEMS ---\n';
  if (tasks.length === 0) {
    tasksContext += 'No action items recorded.\n';
  } else {
    tasks.forEach(t => {
      const ownerStr = t.owner || 'Unassigned';
      const tgStr = t.owner_telegram_id ? ` (${t.owner_telegram_id})` : '';
      tasksContext += `[${t.task_id}] "${t.task}" | Owner: ${ownerStr}${tgStr} | Deadline: ${t.deadline || 'None'} | Status: ${t.status}\n`;
    });
  }

  // 3. Format Open Questions Context
  let questionsContext = '--- OPEN QUESTIONS ---\n';
  if (questions.length === 0) {
    questionsContext += 'No open questions recorded.\n';
  } else {
    questions.forEach(q => {
      const leadStr = q.responsible_person ? ` | Lead: ${q.responsible_person}` : '';
      questionsContext += `[${q.question_id || 'QST'}] "${q.question}"${leadStr} | Status: ${q.status || 'open'}\n`;
    });
  }

  const identityContext = `Current User Asking: ${senderName} ${senderTg ? `(${senderTg})` : ''}\nToday's Date (IST): ${todayStr}`;

  const systemInstructions = `You are EDITH, Chief of Staff AI for this team.\n` +
    `CRITICAL RULES:\n` +
    `1. Answer ONLY from sheet data. Never invent or assume facts outside the provided records.\n` +
    `2. Always cite exact task IDs (e.g. [TSK-1001]) and meeting titles when referencing items.\n` +
    `3. If the requested information or entity is missing or not found in the records, say exactly:\n` +
    `   "I could not find that in the records."\n` +
    `4. Keep your answer calm, sharp, professional, and concise.`;

  const fullPrompt = `${identityContext}\n\n${meetingsContext}\n${tasksContext}\n${questionsContext}\n\nUser Question:\n"${userQuery}"`;

  results.push({
    json: {
      chat_id: chatId,
      user_query: userQuery,
      sender_name: senderName,
      sender_tg: senderTg,
      system_instructions: systemInstructions,
      prompt_text: fullPrompt
    }
  });

  return results;
}

/**
 * Deterministic Query Answer Resolver
 * Evaluates queries against sheet records according to EDITH persona rules.
 * Used for unit testing and offline verification.
 */
function evaluateGroundedQuery(userQuery, meetings = [], tasks = [], questions = [], sender = {}) {
  const q = (userQuery || '').trim().toLowerCase();
  const todayStr = new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
  const senderName = (sender.name || sender.first_name || '').toLowerCase();
  const senderTg = (sender.username || '').replace(/^@/, '').toLowerCase();

  // 1. "What are my pending tasks?"
  if (q.includes('my pending tasks') || q.includes('my tasks') || q.includes('what are my tasks')) {
    const myTasks = tasks.filter(t => {
      if (t.status === 'completed') return false;
      const owner = (t.owner || '').toLowerCase();
      const ownerTg = (t.owner_telegram_id || '').replace(/^@/, '').toLowerCase();
      return (senderName && owner && (owner.includes(senderName) || senderName.includes(owner))) ||
             (senderTg && ownerTg && ownerTg === senderTg);
    });

    if (myTasks.length === 0) {
      return "You have no pending action items in the records.";
    }
    const list = myTasks.map(t => `• [${t.task_id}] **${t.task}** (Due: ${t.deadline || 'No deadline'} | Status: \`${t.status}\`)`).join('\n');
    return `Your pending action items (${myTasks.length}):\n${list}`;
  }

  // 2. "Which tasks are overdue?"
  if (q.includes('overdue')) {
    const overdue = tasks.filter(t => {
      if (t.status === 'completed') return false;
      return t.status === 'overdue' || (t.deadline && t.deadline < todayStr);
    });
    if (overdue.length === 0) {
      return "There are no overdue action items recorded.";
    }
    const list = overdue.map(t => `• [${t.task_id}] **${t.task}** (Owner: ${t.owner || 'Unassigned'} | Deadline: ${t.deadline})`).join('\n');
    return `Overdue action items (${overdue.length}):\n${list}`;
  }

  // 3. "Show Priya's responsibilities" / "[Name]'s responsibilities"
  const nameMatch = q.match(/(?:show|what are|list)\s+([a-z]+)(?:'s)?\s+(?:responsibilities|tasks)/i) ||
                    q.match(/([a-z]+)(?:'s)?\s+(?:responsibilities|tasks)/i);
  if (nameMatch) {
    const targetName = nameMatch[1].toLowerCase();
    const matchedTasks = tasks.filter(t => {
      const owner = (t.owner || '').toLowerCase();
      return owner.includes(targetName);
    });
    if (matchedTasks.length === 0) {
      return `I could not find that in the records. No tasks recorded for ${nameMatch[1]}.`;
    }
    const list = matchedTasks.map(t => `• [${t.task_id}] **${t.task}** (Status: \`${t.status}\` | Due: ${t.deadline || 'None'})`).join('\n');
    const capitalized = nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1);
    return `${capitalized}'s responsibilities (${matchedTasks.length}):\n${list}`;
  }

  // 4. "What did we decide in the last meeting?"
  if (q.includes('decide') || q.includes('last meeting') || q.includes('decisions')) {
    if (meetings.length === 0) {
      return "I could not find that in the records. No meetings logged.";
    }
    const sorted = [...meetings].sort((a, b) => String(b.meeting_date || '').localeCompare(String(a.meeting_date || '')));
    const lastM = sorted[0];
    if (!lastM.decisions) {
      return `In the last meeting ("${lastM.title}", ${lastM.meeting_date}), no specific decisions were recorded.`;
    }
    return `Decisions from the last meeting ("${lastM.title}" on ${lastM.meeting_date}):\n${lastM.decisions}`;
  }

  // 5. "Is the frontend ready?"
  if (q.includes('frontend ready') || q.includes('frontend')) {
    const feTasks = tasks.filter(t => (t.task || '').toLowerCase().includes('frontend'));
    if (feTasks.length === 0) {
      return "I could not find that in the records. No frontend tasks are logged.";
    }
    const completed = feTasks.filter(t => t.status === 'completed');
    if (completed.length === feTasks.length) {
      const ids = feTasks.map(t => `[${t.task_id}]`).join(', ');
      return `Yes, the frontend is ready. All related tasks (${ids}) are marked \`completed\`.`;
    }
    const pending = feTasks.filter(t => t.status !== 'completed');
    const ids = pending.map(t => `[${t.task_id}] ${t.task} (\`${t.status}\`)`).join(', ');
    return `The frontend is not yet fully ready. Pending tasks: ${ids}.`;
  }

  // Default fallback for unknown topic
  return "I could not find that in the records.";
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    processFormatNlQuery,
    evaluateGroundedQuery
  };
}

if (typeof $input !== 'undefined') {
  return processFormatNlQuery($input.all());
}
