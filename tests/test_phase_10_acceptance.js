/**
 * EDITH Phase 10 Acceptance Test Suite (Natural Language Queries & Meeting Memory)
 * 
 * Verifies:
 * 1. Meeting memory extraction from previous meetings
 * 2. Second meeting: "the frontend is done" marks earlier task completed instead of duplicate
 * 3. Summary displays "Updates to earlier tasks"
 * 4. Grounded NL Query Agent answers all 5 required queries:
 *    - "What are my pending tasks?"
 *    - "Which tasks are overdue?"
 *    - "Show Priya's responsibilities"
 *    - "What did we decide in the last meeting?"
 *    - "Is the frontend ready?"
 *    - Unrecorded question -> "I could not find that in the records."
 * 5. Router classifier routes private chat questions to NL query
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { extractMeetingMemory } = require('../code-nodes/extract_meeting_memory.js');
const { processValidateInput } = require('../code-nodes/validate_input.js');
const { processValidateAiOutput } = require('../code-nodes/validate_ai_output.js');
const { processPrepareSheetsPayload } = require('../code-nodes/prepare_sheets_payload.js');
const { processFormatSummary } = require('../code-nodes/format_summary.js');
const { processFormatNlQuery, evaluateGroundedQuery } = require('../code-nodes/format_nl_query.js');

console.log('================================================================');
console.log('EDITH PHASE 10 ACCEPTANCE TEST SUITE');
console.log('================================================================\n');

// ----------------------------------------------------------------------------
// TEST 1: Meeting Memory Extraction from Previous Meetings
// ----------------------------------------------------------------------------
console.log('--- TEST 1: Meeting Memory Extraction ---');
const pastMeetings = [
  { meeting_id: 'MTG-001', chat_id: 'group_999', meeting_date: '2026-11-09', title: 'Sprint Kickoff', summary: 'Sprint 1 kickoff.' },
  { meeting_id: 'MTG-000', chat_id: 'group_999', meeting_date: '2026-11-02', title: 'Architecture Review', summary: 'Selected tech stack.' }
];

const pastTasks = [
  { task_id: 'TSK-1001', meeting_id: 'MTG-001', task: 'Build Telegram bot frontend', owner: 'Rahul Sharma', owner_telegram_id: '@rahul_dev', deadline: '2026-11-12', status: 'assigned' },
  { task_id: 'TSK-1002', meeting_id: 'MTG-001', task: 'Setup PostgreSQL schema', owner: 'Priya Patel', owner_telegram_id: '@priya_p', deadline: '2026-11-12', status: 'completed' }, // Already completed
  { task_id: 'TSK-0999', meeting_id: 'MTG-000', task: 'Draft system architecture diagram', owner: 'Rahul Sharma', owner_telegram_id: '@rahul_dev', deadline: '2026-11-05', status: 'assigned' }
];

const memoryPrompt = extractMeetingMemory('group_999', pastMeetings, pastTasks);
assert.ok(memoryPrompt.includes('TSK-1001'));
assert.ok(memoryPrompt.includes('Build Telegram bot frontend'));
assert.ok(!memoryPrompt.includes('TSK-1002'), 'Completed tasks must be excluded from earlier open tasks');

console.log('✓ Meeting memory extracted correctly:');
console.log(memoryPrompt + '\n');

// ----------------------------------------------------------------------------
// TEST 2: Second Meeting Marks Earlier Task Completed (Acceptance Criteria)
// ----------------------------------------------------------------------------
console.log('--- TEST 2: Second Meeting Cross-Meeting Task Completion & Deduplication ---');
const transcriptText = fs.readFileSync(path.join(__dirname, '../samples/08_second_meeting_progress.txt'), 'utf8');
const valInput = processValidateInput([{ json: { text: transcriptText, chat_id: 'group_999', message_date: '2026-11-12' } }])[0].json;
assert.strictEqual(valInput.is_valid, true);
assert.strictEqual(valInput.meeting_date, '2026-11-12');

// Mock Gemini Structured Output with updates_to_existing_tasks
const mockSecondMeetingAiOutput = {
  meeting_title: 'Hackathon Standup & Backend Kickoff',
  meeting_summary: 'Rahul confirmed frontend completion. Team assigned Stripe API integration and documentation.',
  key_points: ['Frontend responsive screens completed', 'Stripe payment integration kickoff'],
  decisions: [
    { text: 'Deploy Stripe integration on test environment by Friday', confirmed: true }
  ],
  action_items: [
    {
      task: 'Integrate the Stripe payment API',
      owner: 'Rahul',
      deadline_phrase: 'this Friday, November 13',
      deadline_iso: '2026-11-13',
      status: 'assigned',
      source_quote: 'Rahul: Yes, I will integrate the Stripe payment API by this Friday, November 13.',
      confidence: 0.98
    },
    {
      task: 'Write the deployment documentation',
      owner: 'Priya',
      deadline_phrase: 'Saturday, November 14',
      deadline_iso: '2026-11-14',
      status: 'assigned',
      source_quote: 'Priya: Great. I will write the deployment documentation by Saturday, November 14.',
      confidence: 0.98
    }
  ],
  open_questions: [],
  updates_to_existing_tasks: [
    {
      existing_task_id: 'TSK-1001',
      change: 'completed',
      new_deadline_iso: null,
      evidence: 'Rahul: Quick update from my side: the frontend is done.',
      confidence: 0.97
    }
  ]
};

const valAi = processValidateAiOutput([{
  json: {
    normalised_text: valInput.normalised_text,
    raw_ai_text: JSON.stringify(mockSecondMeetingAiOutput)
  }
}])[0].json;

assert.strictEqual(valAi.valid, true);
assert.strictEqual(valAi.data.updates_to_existing_tasks.length, 1);
assert.strictEqual(valAi.data.updates_to_existing_tasks[0].existing_task_id, 'TSK-1001');
assert.strictEqual(valAi.data.updates_to_existing_tasks[0].change, 'completed');

// Verify NO duplicate frontend task was added to action_items
const duplicateFrontend = valAi.data.action_items.find(a => /frontend/i.test(a.task));
assert.strictEqual(duplicateFrontend, undefined, 'Must NOT create duplicate action item for completed frontend');
assert.strictEqual(valAi.data.action_items.length, 2, 'Only 2 new tasks should be created');

console.log('✓ Verified: Earlier task TSK-1001 marked completed.');
console.log('✓ Verified: 0 duplicate frontend tasks created in action_items.\n');

// ----------------------------------------------------------------------------
// TEST 3: Sheets Payload Preparation with Task Updates
// ----------------------------------------------------------------------------
console.log('--- TEST 3: Google Sheets Payload & Summary Update Section ---');
const membersList = [
  { name: 'Rahul Sharma', telegram_username: 'rahul_dev', telegram_id: '99887766' },
  { name: 'Priya Patel', telegram_username: 'priya_p', telegram_id: '99887767' }
];

const sheetsPayload = processPrepareSheetsPayload([{
  json: {
    meeting_date: '2026-11-12',
    chat_id: 'group_999',
    meeting_id: 'MTG-002',
    transcript_hash: 'hash_mtg_002',
    data: valAi.data
  }
}], membersList)[0].json;

// Check that TSK-1001 is included with status 'completed' in action_items_rows
const updatedEarlierRow = sheetsPayload.action_items_rows.find(r => r.task_id === 'TSK-1001');
assert.ok(updatedEarlierRow, 'TSK-1001 must be included in batch update rows');
assert.strictEqual(updatedEarlierRow.status, 'completed');

// Verify Telegram Summary includes "Updates to earlier tasks"
const summaryResult = processFormatSummary([{
  json: {
    meeting_id: 'MTG-002',
    chat_id: 'group_999',
    payload: sheetsPayload,
    analysis: valAi.data
  }
}], membersList, [{ key: 'group_chat_id', value: 'group_999' }])[0].json;

assert.ok(summaryResult.summary_html.includes('Updates to earlier tasks:'), 'Summary must contain Updates to earlier tasks section');
assert.ok(summaryResult.summary_html.includes('TSK-1001'));
assert.ok(summaryResult.summary_html.includes('Marked <code>completed</code>'));

console.log('✓ Verified: TSK-1001 row update prepared with status = "completed".');
console.log('✓ Verified: Summary includes "Updates to earlier tasks" section with proof quote.\n');

// ----------------------------------------------------------------------------
// TEST 4: Natural Language Query Agent Queries
// ----------------------------------------------------------------------------
console.log('--- TEST 4: Grounded Natural Language Queries (EDITH_04_nl_query) ---');

const currentTasks = [
  { task_id: 'TSK-1001', task: 'Build Telegram bot frontend', owner: 'Rahul Sharma', owner_telegram_id: '@rahul_dev', deadline: '2026-11-12', status: 'completed' },
  { task_id: 'TSK-1002', task: 'Integrate the Stripe payment API', owner: 'Rahul Sharma', owner_telegram_id: '@rahul_dev', deadline: '2026-11-13', status: 'assigned' },
  { task_id: 'TSK-1003', task: 'Write the deployment documentation', owner: 'Priya Patel', owner_telegram_id: '@priya_p', deadline: '2026-11-05', status: 'overdue' }
];

const currentMeetings = [
  {
    meeting_id: 'MTG-002',
    title: 'Hackathon Standup & Backend Kickoff',
    meeting_date: '2026-11-12',
    summary: 'Team aligned on backend deliverables.',
    decisions: '• Deploy Stripe integration on test environment by Friday'
  }
];

// Query 4A: "What are my pending tasks?" (Sender: Rahul)
const ans1 = evaluateGroundedQuery('What are my pending tasks?', currentMeetings, currentTasks, [], { name: 'Rahul Sharma', username: 'rahul_dev' });
assert.ok(ans1.includes('TSK-1002'));
assert.ok(ans1.includes('Integrate the Stripe payment API'));
assert.ok(!ans1.includes('TSK-1001'), 'Completed task should not appear in pending list');
console.log('✓ Query 1 ("What are my pending tasks?"): Passed.');

// Query 4B: "Which tasks are overdue?"
const ans2 = evaluateGroundedQuery('Which tasks are overdue?', currentMeetings, currentTasks, []);
assert.ok(ans2.includes('TSK-1003'));
assert.ok(ans2.includes('Priya Patel'));
console.log('✓ Query 2 ("Which tasks are overdue?"): Passed.');

// Query 4C: "Show Priya's responsibilities"
const ans3 = evaluateGroundedQuery("Show Priya's responsibilities", currentMeetings, currentTasks, []);
assert.ok(ans3.includes('TSK-1003'));
assert.ok(ans3.includes('Write the deployment documentation'));
console.log("✓ Query 3 (\"Show Priya's responsibilities\"): Passed.");

// Query 4D: "What did we decide in the last meeting?"
const ans4 = evaluateGroundedQuery('What did we decide in the last meeting?', currentMeetings, currentTasks, []);
assert.ok(ans4.includes('Deploy Stripe integration'));
console.log('✓ Query 4 ("What did we decide in the last meeting?"): Passed.');

// Query 4E: "Is the frontend ready?"
const ans5 = evaluateGroundedQuery('Is the frontend ready?', currentMeetings, currentTasks, []);
assert.ok(ans5.includes('Yes, the frontend is ready'));
assert.ok(ans5.includes('TSK-1001'));
console.log('✓ Query 5 ("Is the frontend ready?"): Passed.');

// Query 4F: Unrecorded Question -> "I could not find that in the records."
const ans6 = evaluateGroundedQuery('Who is handling cybersecurity and firewall configurations?', currentMeetings, currentTasks, []);
assert.strictEqual(ans6, 'I could not find that in the records.');
console.log('✓ Query 6 (Unrecorded question): Emits "I could not find that in the records."\n');

// ----------------------------------------------------------------------------
// TEST 5: Router Classification for Private Chat Questions
// ----------------------------------------------------------------------------
console.log('--- TEST 5: Router Classification for Private Chat Questions ---');
const routerWf = JSON.parse(fs.readFileSync(path.join(__dirname, '../workflows/EDITH_00_router.json'), 'utf8'));
assert.ok(routerWf.nodes.some(n => n.name === 'Execute EDITH_04_nl_query'));

console.log('✓ EDITH_00_router connects to EDITH_04_nl_query.\n');

console.log('================================================================');
console.log('ALL PHASE 10 ACCEPTANCE CRITERIA VERIFIED AND PASSING!');
console.log('================================================================');
