const assert = require('assert');
const { processFormatSummary } = require('../code-nodes/format_summary.js');
const { processUpdateAction } = require('../code-nodes/parse_update_action.js');
const { processValidateClarify } = require('../code-nodes/validate_clarify_response.js');
const { processPrepareUpdateRow } = require('../code-nodes/prepare_task_update_row.js');

console.log('================================================================');
console.log('EDITH PHASE 7 ACCEPTANCE TEST SUITE');
console.log('================================================================\n');

// ----------------------------------------------------------------------------
// TEST 1: Telegram HTML Summary & Inline Clarification Buttons
// ----------------------------------------------------------------------------
console.log('--- TEST 1: HTML Summary & Inline Buttons Generation ---');
const samplePayload = [{
  json: {
    chat_id: '123456789',
    meeting_title: 'Sprint Review & Architecture Sync',
    meeting_date: '2026-11-09',
    meeting_id: 'MTG-8F3B1A02',
    analysis: {
      decisions: [
        { text: 'Deploy service to Mumbai AWS region', confirmed: true },
        { text: 'Evaluate Apache Kafka for event bus', confirmed: false }
      ]
    },
    payload: {
      meeting_id: 'MTG-8F3B1A02',
      meeting_row: {
        title: 'Sprint Review & Architecture Sync',
        meeting_date: '2026-11-09',
        meeting_id: 'MTG-8F3B1A02'
      },
      action_items_rows: [
        {
          task_id: 'TSK-1001',
          task: 'Setup PostgreSQL schema & migrations',
          owner: 'Dwipayan',
          owner_telegram_id: '@dwipayan',
          deadline: '2026-11-13',
          status: 'assigned'
        },
        {
          task_id: 'TSK-1002',
          task: 'Prepare API integration testing framework',
          owner: '',
          owner_telegram_id: '',
          deadline: '2026-11-13',
          status: 'unassigned'
        },
        {
          task_id: 'TSK-1003',
          task: 'Conduct load testing on auth service',
          owner: 'Priya',
          owner_telegram_id: '@priya',
          deadline: '',
          deadline_phrase: 'sometime next week',
          status: 'ambiguous_deadline'
        }
      ],
      open_questions_rows: [
        {
          question: 'Do we have staging credentials for Stripe sandbox?',
          responsible_person: 'Rahul'
        }
      ]
    }
  }
}];

const sampleMembers = [
  { name: 'Dwipayan', telegram_username: 'dwipayan' },
  { name: 'Priya', telegram_username: 'priya' },
  { name: 'Rahul', telegram_username: 'rahul' }
];

const sampleConfig = [
  { key: 'group_chat_id', value: '-100987654321' }
];

const summaryResult = processFormatSummary(samplePayload, sampleMembers, sampleConfig);
const summaryJson = summaryResult[0].json;

assert.strictEqual(summaryJson.target_chat_id, '-100987654321', 'Target chat must use Config.group_chat_id');
assert.ok(summaryJson.summary_html.includes('<b>EDITH MEETING REPORT</b>'), 'Summary must contain header');
assert.ok(summaryJson.summary_html.includes('<b>Title:</b> Sprint Review &amp; Architecture Sync'), 'Title must be escaped');
assert.ok(summaryJson.summary_html.includes('<b>Date:</b> 2026-11-09'), 'Date must be present');
assert.ok(summaryJson.summary_html.includes('• Evaluate Apache Kafka for event bus <i>(suggested)</i>'), 'Unconfirmed decision must be marked suggested');
assert.ok(summaryJson.summary_html.includes('Fri, 13 Nov 2026'), 'Deadlines must be formatted like Fri, 13 Nov 2026');
assert.ok(summaryJson.summary_html.includes('Logged by EDITH | <code>MTG-8F3B1A02</code>'), 'Footer must contain meeting ID');

console.log('✓ HTML Summary formatting verified.');
console.log('✓ Group chat ID resolved from Config tab.');
console.log('✓ Unconfirmed decisions tagged as suggested.');
console.log('✓ Deadlines formatted as "Fri, 13 Nov 2026".');

// Check clarification items
assert.strictEqual(summaryJson.clarification_dispatches.length, 2, 'Must generate 2 clarification messages');
for (const dispatch of summaryJson.clarification_dispatches) {
  assert.ok(dispatch.reply_markup?.inline_keyboard?.length > 0, 'Must have inline keyboard buttons');
  for (const row of dispatch.reply_markup.inline_keyboard) {
    for (const btn of row) {
      const byteLen = Buffer.byteLength(btn.callback_data, 'utf8');
      assert.ok(byteLen < 64, `Button callback_data '${btn.callback_data}' must be under 64 bytes (was ${byteLen})`);
      assert.ok(btn.callback_data.startsWith('act|'), `Button callback_data must follow 'act|<task_id>|<value>' format`);
    }
  }
}
console.log('✓ Individual clarification messages and inline button payloads (< 64 bytes) verified.\n');

// ----------------------------------------------------------------------------
// TEST 2: Fix Unassigned Task through Button Click
// ----------------------------------------------------------------------------
console.log('--- TEST 2: Fix Unassigned Task via Inline Button ---');
const buttonClickUpdate = [{
  json: {
    callback_data: 'act|TSK-1002|me',
    callback_query_id: 'query_998877',
    chat_id: '-100987654321',
    from: { username: 'rahul', id: 98765 }
  }
}];

const actionParsed = processUpdateAction(buttonClickUpdate);
assert.strictEqual(actionParsed[0].json.is_callback, true, 'Must identify as callback query');
assert.strictEqual(actionParsed[0].json.task_id, 'TSK-1002', 'Must extract target task_id');
assert.strictEqual(actionParsed[0].json.new_owner, '@rahul', 'Must assign to clicking user');

const existingDatabaseTasks = [
  {
    task_id: 'TSK-1001',
    task: 'Setup PostgreSQL schema & migrations',
    owner: 'Dwipayan',
    owner_telegram_id: '@dwipayan',
    deadline: '2026-11-13',
    status: 'assigned'
  },
  {
    task_id: 'TSK-1002',
    task: 'Prepare API integration testing framework',
    owner: '',
    owner_telegram_id: '',
    deadline: '2026-11-13',
    status: 'unassigned'
  },
  {
    task_id: 'TSK-1003',
    task: 'Conduct load testing on auth service',
    owner: 'Priya',
    owner_telegram_id: '@priya',
    deadline: '',
    status: 'missing_deadline'
  }
];

const updateRowResult = processPrepareUpdateRow([{}], actionParsed[0].json, existingDatabaseTasks);
const updatedTask = updateRowResult[0].json.updated_row;

assert.strictEqual(updatedTask.task_id, 'TSK-1002', 'Task ID matches');
assert.strictEqual(updatedTask.owner, 'rahul', 'Owner updated');
assert.strictEqual(updatedTask.owner_telegram_id, '@rahul', 'Owner telegram handle updated');
assert.strictEqual(updatedTask.status, 'assigned', 'Status must be recomputed to assigned');
assert.ok(updateRowResult[0].json.confirmation_message.includes('Task Updated: TSK-1002'), 'Confirmation message formatted in EDITH persona');

console.log('✓ Unassigned task fixed via button click:');
console.log(`  Task: ${updatedTask.task} (${updatedTask.task_id})`);
console.log(`  Assignee: ${updatedTask.owner_telegram_id}`);
console.log(`  Status Recomputed: ${updatedTask.status}\n`);

// ----------------------------------------------------------------------------
// TEST 3: Fix Missing-Deadline Task through Typed Reply ("by next Thursday")
// ----------------------------------------------------------------------------
console.log('--- TEST 3: Fix Missing-Deadline Task via Typed Reply ---');
const typedReplyInput = [{
  json: {
    route: 'reply',
    reply_to_text: 'Incomplete deadline detected.\nTask: Conduct load testing on auth service\nID: TSK-1003\nAssignee: @priya',
    text: 'Priya will complete it by next Thursday',
    chat_id: '-100987654321',
    from: { username: 'priya' }
  }
}];

const replyParsed = processUpdateAction(typedReplyInput);
assert.strictEqual(replyParsed[0].json.is_clarify_reply, true, 'Must identify as clarify reply');
assert.strictEqual(replyParsed[0].json.task_id, 'TSK-1003', 'Must extract target task_id from parent text');

// Simulate Gemini extraction on "Priya will complete it by next Thursday"
// anchored to reference date 2026-11-07 (Saturday) -> next Thursday is 2026-11-12
const geminiClarifyOutput = [{
  json: {
    owner: '@priya',
    deadline_iso: '2026-11-12',
    confidence: 0.96
  }
}];

const validatedClarify = processValidateClarify(geminiClarifyOutput, replyParsed[0].json);
assert.strictEqual(validatedClarify[0].json.is_valid, true, 'Extraction must be valid');
assert.strictEqual(validatedClarify[0].json.new_deadline, '2026-11-12', 'Deadline must be 2026-11-12');

const updateReplyRowResult = processPrepareUpdateRow([{}], validatedClarify[0].json, existingDatabaseTasks);
const updatedReplyTask = updateReplyRowResult[0].json.updated_row;

assert.strictEqual(updatedReplyTask.task_id, 'TSK-1003', 'Task ID matches');
assert.strictEqual(updatedReplyTask.deadline, '2026-11-12', 'Deadline updated to 2026-11-12');
assert.strictEqual(updatedReplyTask.status, 'assigned', 'Status must be recomputed to assigned');
assert.ok(updateReplyRowResult[0].json.confirmation_message.includes('Task Updated: TSK-1003'), 'Confirmation message formatted in EDITH persona');

console.log('✓ Missing deadline fixed via typed reply:');
console.log(`  Task: ${updatedReplyTask.task} (${updatedReplyTask.task_id})`);
console.log(`  Deadline: 📅 ${updatedReplyTask.deadline}`);
console.log(`  Status Recomputed: ${updatedReplyTask.status}\n`);

// ----------------------------------------------------------------------------
// TEST 4: Low Confidence / Unrelated Typed Reply Guardrail
// ----------------------------------------------------------------------------
console.log('--- TEST 4: Low Confidence Reply Guardrail ---');
const geminiLowConfidence = [{
  json: {
    owner: null,
    deadline_iso: null,
    confidence: 0.25
  }
}];

const lowConfidenceValidated = processValidateClarify(geminiLowConfidence, replyParsed[0].json);
assert.strictEqual(lowConfidenceValidated[0].json.is_valid, false, 'Must reject low confidence');
assert.ok(lowConfidenceValidated[0].json.retry_message.includes('could not determine an assignee or deadline'), 'Must ask again politely');

console.log('✓ Low confidence / irrelevant reply triggers polite retry message without corrupting Google Sheets.\n');

console.log('================================================================');
console.log('ALL PHASE 7 ACCEPTANCE CRITERIA VERIFIED AND PASSING!');
console.log('================================================================');
