/**
 * EDITH Phase 9 Acceptance Test Suite
 * 
 * Verifies:
 * 1. Member registration (/register <name>)
 * 2. Scheduled reminder triggered exactly once for task due tomorrow
 * 3. Anti-spam suppression on subsequent execution
 * 4. "Done" button marks task completed
 * 5. Natural language progress matching (single match vs ambiguous)
 * 6. Filtered task board queries (/tasks, /tasks overdue, /tasks all)
 */

const assert = require('assert');
const { processRegisterMember } = require('../code-nodes/register_member.js');
const { processStagedReminders } = require('../code-nodes/evaluate_staged_reminders.js');
const { processProgressUpdate } = require('../code-nodes/parse_progress_update.js');
const { processPrepareUpdateRow } = require('../code-nodes/prepare_task_update_row.js');
const { processFormatTasksFiltered } = require('../code-nodes/format_tasks_filtered.js');

console.log('================================================================');
console.log('EDITH PHASE 9 ACCEPTANCE TEST SUITE');
console.log('================================================================\n');

// ----------------------------------------------------------------------------
// TEST 1: Member Registration (/register Rahul Sharma)
// ----------------------------------------------------------------------------
console.log('--- TEST 1: Member Registration (/register) ---');
const registerInput = [{
  json: {
    text: '/register Rahul Sharma',
    chat_id: '99887766', // Private DM chat
    from: {
      id: 99887766,
      username: 'rahul_dev',
      first_name: 'Rahul',
      last_name: 'Sharma'
    }
  }
}];

const regResult = processRegisterMember(registerInput, [])[0].json;
assert.strictEqual(regResult.member_record.name, 'Rahul Sharma');
assert.strictEqual(regResult.member_record.telegram_username, 'rahul_dev');
assert.strictEqual(regResult.member_record.telegram_id, '99887766');
assert.strictEqual(regResult.member_record.chat_id, '99887766');
assert.strictEqual(regResult.reply_message, 'Registered. EDITH will now send your reminders directly.');

console.log('✓ Member registration successful:');
console.log(`  Name: ${regResult.member_record.name}`);
console.log(`  Telegram ID: ${regResult.member_record.telegram_id}`);
console.log(`  DM Chat ID: ${regResult.member_record.chat_id}`);
console.log(`  Response: "${regResult.reply_message}"\n`);

// ----------------------------------------------------------------------------
// TEST 2: Task with deadline tomorrow triggers personal reminder
// ----------------------------------------------------------------------------
console.log('--- TEST 2: Task Due Tomorrow Reminder & Routing ---');
const simulatedTodayMs = new Date('2026-11-09T09:00:00+05:30').getTime(); // Today is 2026-11-09

const membersDatabase = [
  { name: 'Rahul Sharma', telegram_username: 'rahul_dev', telegram_id: '99887766', chat_id: '99887766' }
];

const configDatabase = {
  staged_reminders_enabled: 'true',
  group_chat_id: '-100123456789'
};

const tasksDatabase = [
  {
    task_id: 'TSK-1001',
    task: 'Build Telegram bot router',
    owner: 'Rahul Sharma',
    owner_telegram_id: '@rahul_dev',
    deadline: '2026-11-10', // Tomorrow!
    status: 'assigned',
    last_reminder_stage: 0
  }
];

const reminderRun1 = processStagedReminders([{}], tasksDatabase, membersDatabase, configDatabase, simulatedTodayMs)[0].json;
assert.strictEqual(reminderRun1.has_reminders, true, 'Must have reminders to dispatch');
assert.strictEqual(reminderRun1.reminder_dispatches.length, 1, 'Exactly 1 reminder dispatch');

const dispatch = reminderRun1.reminder_dispatches[0];
assert.strictEqual(dispatch.chat_id, '99887766', 'Must route directly to registered member DM chat_id');
assert.ok(dispatch.text.includes('Rahul Sharma, your "Build Telegram bot router" deadline is tomorrow. Current progress?'));

// Verify inline buttons
const buttons = dispatch.reply_markup.inline_keyboard[0];
assert.strictEqual(buttons[0].text, 'Done');
assert.strictEqual(buttons[0].callback_data, 'rem|TSK-1001|completed');
assert.strictEqual(buttons[1].text, 'In progress');
assert.strictEqual(buttons[1].callback_data, 'rem|TSK-1001|in_progress');
assert.strictEqual(buttons[2].text, 'Need more time');
assert.strictEqual(buttons[2].callback_data, 'rem|TSK-1001|more_time');

console.log('✓ Reminder triggered for task due tomorrow:');
console.log(`  Destination: DM Chat ${dispatch.chat_id}`);
console.log(`  Message: "${dispatch.text}"`);
console.log(`  Buttons: [${buttons.map(b => b.text).join(' | ')}]\n`);

// ----------------------------------------------------------------------------
// TEST 3: Anti-Spam (Running schedule again on same day skips reminder)
// ----------------------------------------------------------------------------
console.log('--- TEST 3: Anti-Spam Notification Suppression ---');
// After Run 1, last_reminder_stage was updated to 2
const updatedTasks = reminderRun1.tasks_to_update;
assert.strictEqual(updatedTasks[0].last_reminder_stage, 2);

const reminderRun2 = processStagedReminders([{}], updatedTasks, membersDatabase, configDatabase, simulatedTodayMs)[0].json;
assert.strictEqual(reminderRun2.has_reminders, false, 'Subsequent run must suppress reminders (anti-spam)');
assert.strictEqual(reminderRun2.reminder_dispatches?.length || 0, 0);

console.log('✓ Anti-spam verified: Second manual execution on the same day generated 0 duplicate messages.\n');

// ----------------------------------------------------------------------------
// TEST 4: "Done" Button Callback Marks Task Completed
// ----------------------------------------------------------------------------
console.log('--- TEST 4: "Done" Button Marks Task Completed ---');
const doneCallbackInput = [{
  json: {
    callback_data: 'rem|TSK-1001|completed',
    callback_query_id: 'cb_query_112233',
    chat_id: '99887766'
  }
}];

const progressAction = processProgressUpdate(doneCallbackInput, updatedTasks)[0].json;
assert.strictEqual(progressAction.action_type, 'reminder_callback');
assert.strictEqual(progressAction.task_id, 'TSK-1001');
assert.strictEqual(progressAction.new_status, 'completed');

const updateRowResult = processPrepareUpdateRow([{}], progressAction, updatedTasks)[0].json;
assert.strictEqual(updateRowResult.updated_row.status, 'completed');
assert.ok(updateRowResult.confirmation_message.includes('Task Updated: TSK-1001'));
assert.ok(updateRowResult.confirmation_message.includes('`completed`'));

console.log('✓ "Done" button callback processed successfully:');
console.log(`  Task: ${updateRowResult.updated_row.task_id}`);
console.log(`  Status Updated: ${updateRowResult.updated_row.status}\n`);

// ----------------------------------------------------------------------------
// TEST 5: Natural Language Progress Update Matching
// ----------------------------------------------------------------------------
console.log('--- TEST 5: Natural Language Progress Update ---');
// Case 5A: Single confident match
const mockGeminiMatch = [{
  json: {
    chat_id: '99887766',
    match_result: {
      matched_task_id: 'TSK-1001',
      new_status: 'completed',
      confidence: 0.94,
      candidate_task_ids: ['TSK-1001']
    }
  }
}];

const nlMatchSingle = processProgressUpdate(mockGeminiMatch, updatedTasks)[0].json;
assert.strictEqual(nlMatchSingle.action_type, 'nl_match_single');
assert.strictEqual(nlMatchSingle.task_id, 'TSK-1001');
assert.strictEqual(nlMatchSingle.new_status, 'completed');
console.log('✓ High-confidence single natural language match resolved.');

// Case 5B: Ambiguous match with multiple candidates
const mockGeminiAmbiguous = [{
  json: {
    chat_id: '99887766',
    match_result: {
      matched_task_id: null,
      new_status: 'completed',
      confidence: 0.50,
      candidate_task_ids: ['TSK-1001', 'TSK-1002']
    }
  }
}];

const nlMatchAmbiguous = processProgressUpdate(mockGeminiAmbiguous, [
  { task_id: 'TSK-1001', task: 'Build frontend router' },
  { task_id: 'TSK-1002', task: 'Frontend CSS styling' }
])[0].json;

assert.strictEqual(nlMatchAmbiguous.action_type, 'nl_match_ambiguous');
assert.strictEqual(nlMatchAmbiguous.message, 'Which task did you mean?');
assert.ok(nlMatchAmbiguous.reply_markup.inline_keyboard.length >= 2);
console.log('✓ Ambiguous natural language match triggers "Which task did you mean?" candidate buttons.\n');

// ----------------------------------------------------------------------------
// TEST 6: Filtered Task Boards (/tasks, /tasks overdue, /tasks all)
// ----------------------------------------------------------------------------
console.log('--- TEST 6: Filtered Task Boards ---');
const sampleTasks = [
  { task_id: 'TSK-01', task: 'API Router', owner: 'Rahul Sharma', owner_telegram_id: '@rahul_dev', deadline: '2026-11-15', status: 'assigned' },
  { task_id: 'TSK-02', task: 'Database Migration', owner: 'Priya Patel', owner_telegram_id: '@priya_p', deadline: '2026-11-01', status: 'overdue' },
  { task_id: 'TSK-03', task: 'Documentation', owner: '', owner_telegram_id: '', deadline: '', status: 'unassigned' }
];

// 6A: /tasks (Sender personal)
const myTasksBoard = processFormatTasksFiltered([{}], sampleTasks, {
  chat_id: '123',
  from: { username: 'rahul_dev', first_name: 'Rahul', last_name: 'Sharma' },
  text: '/tasks'
})[0].json;
assert.ok(myTasksBoard.message_text.includes('Your Assigned Tasks (1 pending)'));
assert.ok(myTasksBoard.message_text.includes('API Router'));
console.log('✓ /tasks returns personal assigned tasks.');

// 6B: /tasks overdue
const overdueBoard = processFormatTasksFiltered([{}], sampleTasks, {
  chat_id: '123',
  text: '/tasks overdue'
})[0].json;
assert.ok(overdueBoard.message_text.includes('EDITH Tasks: Overdue (1 items)'));
assert.ok(overdueBoard.message_text.includes('Database Migration'));
console.log('✓ /tasks overdue returns overdue items.');

// 6C: /tasks all (Grouped by owner)
const allBoard = processFormatTasksFiltered([{}], sampleTasks, {
  chat_id: '123',
  text: '/tasks all'
})[0].json;
assert.ok(allBoard.message_text.includes('EDITH Master Task Board (3 open tasks)'));
assert.ok(allBoard.message_text.includes('👤 **Rahul Sharma**'));
assert.ok(allBoard.message_text.includes('👤 **Priya Patel**'));
assert.ok(allBoard.message_text.includes('👤 **Unassigned**'));
console.log('✓ /tasks all returns tasks grouped by owner.\n');

console.log('================================================================');
console.log('ALL PHASE 9 ACCEPTANCE CRITERIA VERIFIED AND PASSING!');
console.log('================================================================');
