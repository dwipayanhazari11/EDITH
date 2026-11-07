/**
 * EDITH AI Output Validator & Normalizer (code-nodes/validate_ai_output.js)
 * 
 * Safely parses Gemini JSON response, verifies all schema invariants,
 * normalizes placeholder owners to null, validates ISO deadlines,
 * recomputes deterministic task statuses, deduplicates internal tasks,
 * and manages the retry counter.
 */

const ALLOWED_STATUSES = [
  'assigned',
  'missing_deadline',
  'ambiguous_deadline',
  'conflicting_deadline',
  'unassigned'
];

const PLACEHOLDER_OWNERS = new Set([
  'unknown',
  'tbd',
  'team',
  'everyone',
  'all',
  'n/a',
  'na',
  'unassigned',
  'none',
  'null',
  ''
]);

function processValidateAiOutput(items) {
  const results = [];

  for (const item of items) {
    const json = item.json;

    const retryCount = json.retry_count || 0;
    const rawTranscript = json.normalised_text || json.original_text || '';
    const rawAiText = json.raw_ai_text || (json.candidates?.[0]?.content?.parts?.[0]?.text) || (typeof json.text === 'string' ? json.text : '') || '';

    const errors = [];
    let parsed = null;

    // 1. Safe JSON Parsing
    try {
      const cleanText = rawAiText
        .replace(/^\s*```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();

      parsed = JSON.parse(cleanText);
    } catch (err) {
      errors.push(`Invalid JSON syntax: ${err.message}`);
    }

    // 2. Schema Structure Verification
    if (parsed && typeof parsed === 'object') {
      if (!parsed.meeting_title || typeof parsed.meeting_title !== 'string') {
        errors.push('Missing or invalid "meeting_title" (expected non-empty string).');
      }

      if (parsed.meeting_summary === undefined || typeof parsed.meeting_summary !== 'string') {
        errors.push('Missing or invalid "meeting_summary" (expected string).');
      }

      if (!Array.isArray(parsed.key_points)) {
        errors.push('Missing or invalid "key_points" (expected array).');
      }

      if (!Array.isArray(parsed.decisions)) {
        errors.push('Missing or invalid "decisions" (expected array).');
      } else {
        parsed.decisions = parsed.decisions.map(d => ({
          text: String(d.text || '').trim(),
          confirmed: Boolean(d.confirmed)
        })).filter(d => d.text.length > 0);
      }

      if (!Array.isArray(parsed.action_items)) {
        errors.push('Missing or invalid "action_items" (expected array).');
      } else {
        const cleanTasks = [];
        const seenTaskNames = new Set();

        for (let i = 0; i < parsed.action_items.length; i++) {
          const raw = parsed.action_items[i];
          const taskName = String(raw.task || '').trim();

          if (!taskName) {
            errors.push(`Action item #${i + 1} has an empty "task" name.`);
            continue;
          }

          // Deduplication inside the same response
          const normalizedTaskKey = taskName.toLowerCase().replace(/[^\w\s]/g, '');
          if (seenTaskNames.has(normalizedTaskKey)) {
            continue;
          }
          seenTaskNames.add(normalizedTaskKey);

          // Owner Normalization (convert Unknown, TBD, Team, etc. to null)
          let owner = raw.owner !== null && raw.owner !== undefined ? String(raw.owner).trim() : null;
          if (owner && PLACEHOLDER_OWNERS.has(owner.toLowerCase())) {
            owner = null;
          }

          // Deadline Phrase Normalization
          const deadlinePhrase = raw.deadline_phrase !== null && raw.deadline_phrase !== undefined 
            ? String(raw.deadline_phrase).trim() 
            : null;

          // Deadline ISO Date Validation
          let deadlineIso = raw.deadline_iso !== null && raw.deadline_iso !== undefined 
            ? String(raw.deadline_iso).trim() 
            : null;

          if (deadlineIso) {
            const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(deadlineIso) && !isNaN(new Date(deadlineIso + 'T00:00:00Z').getTime());
            if (!isValidDate) {
              errors.push(`Action item "${taskName}" has invalid deadline_iso format ("${deadlineIso}"). Expected YYYY-MM-DD.`);
              deadlineIso = null;
            }
          }

          // Status Recomputation & Verification
          let status = raw.status || 'assigned';
          const isVague = deadlinePhrase && /(soon|sometime|next week|later|in a few days|next sprint|eventually|after exams|maybe)/i.test(deadlinePhrase);

          if (status === 'conflicting_deadline') {
            deadlineIso = null;
          } else if (!owner) {
            status = 'unassigned';
          } else if (isVague || (deadlinePhrase && !deadlineIso)) {
            status = 'ambiguous_deadline';
            deadlineIso = null;
          } else if (!deadlineIso && !deadlinePhrase) {
            status = 'missing_deadline';
          } else if (owner && deadlineIso) {
            status = 'assigned';
          }

          if (!ALLOWED_STATUSES.includes(status)) {
            errors.push(`Action item "${taskName}" has unpermitted status "${status}".`);
            status = owner ? 'assigned' : 'unassigned';
          }

          // Source Quote Validation
          const sourceQuote = String(raw.source_quote || '').trim();
          if (!sourceQuote) {
            errors.push(`Action item "${taskName}" missing required "source_quote".`);
          }

          let confidence = typeof raw.confidence === 'number' ? raw.confidence : 0.9;
          if (confidence < 0) confidence = 0;
          if (confidence > 1) confidence = 1;

          cleanTasks.push({
            task: taskName,
            owner: owner,
            deadline_phrase: deadlinePhrase,
            deadline_iso: deadlineIso,
            status: status,
            source_quote: sourceQuote,
            confidence: confidence
          });
        }

        parsed.action_items = cleanTasks;
      }

      if (!Array.isArray(parsed.open_questions)) {
        errors.push('Missing or invalid "open_questions" (expected array).');
      } else {
        parsed.open_questions = parsed.open_questions.map(q => ({
          question: String(q.question || '').trim(),
          related_task: q.related_task ? String(q.related_task).trim() : null,
          responsible_person: q.responsible_person ? String(q.responsible_person).trim() : null
        })).filter(q => q.question.length > 0);
      }

      // Validate optional updates_to_existing_tasks (Phase 10: Meeting Memory)
      if (parsed.updates_to_existing_tasks !== undefined) {
        if (!Array.isArray(parsed.updates_to_existing_tasks)) {
          errors.push('Invalid "updates_to_existing_tasks" (expected array if provided).');
        } else {
          const cleanUpdates = [];
          const ALLOWED_CHANGES = ['completed', 're-discussed', 'deadline_changed'];

          for (const u of parsed.updates_to_existing_tasks) {
            const taskId = String(u.existing_task_id || '').trim();
            const change = String(u.change || '').trim().toLowerCase();
            const evidence = String(u.evidence || '').trim();
            const confidence = typeof u.confidence === 'number' ? u.confidence : 0.9;
            const newDeadlineIso = u.new_deadline_iso ? String(u.new_deadline_iso).trim() : null;

            if (taskId && ALLOWED_CHANGES.includes(change) && confidence >= 0.85) {
              cleanUpdates.push({
                existing_task_id: taskId,
                change: change,
                new_deadline_iso: newDeadlineIso,
                evidence: evidence,
                confidence: confidence
              });
            }
          }
          parsed.updates_to_existing_tasks = cleanUpdates;

          // Deduplication: If an existing task was marked completed, ensure no duplicate
          // was erroneously created in action_items for the same completion report
          if (cleanUpdates.length > 0 && Array.isArray(parsed.action_items)) {
            const completedEvidencePhrases = cleanUpdates
              .filter(u => u.change === 'completed')
              .map(u => (u.evidence || '').toLowerCase());

            parsed.action_items = parsed.action_items.filter(act => {
              const actName = act.task.toLowerCase();
              const quote = (act.source_quote || '').toLowerCase();
              const isRedundantCompletion = completedEvidencePhrases.some(ev => 
                (ev.includes(actName) || quote.includes(ev)) && /(finished|done|complete|wrapped up)/i.test(ev)
              );
              return !isRedundantCompletion;
            });
          }
        }
      } else {
        parsed.updates_to_existing_tasks = [];
      }
    }

    // 3. Test Switch for automated acceptance tests (#test_bad_json or FORCE_BAD_JSON=true)
    const isProd = typeof process !== 'undefined' && process.env.NODE_ENV === 'production' && process.env.FORCE_BAD_JSON !== 'true';
    const isBadJsonTest = !isProd && (rawTranscript.includes('#test_bad_json') || (typeof process !== 'undefined' && process.env.FORCE_BAD_JSON === 'true'));
    const isPermanentFailureTest = !isProd && rawTranscript.includes('#test_bad_json_permanent');

    if (isBadJsonTest) {
      if (retryCount === 0 || isPermanentFailureTest) {
        errors.push('SIMULATED_ERROR: Magic phrase #test_bad_json triggered forced validation failure.');
      }
    }

    const isValid = errors.length === 0 && parsed !== null;

    results.push({
      json: {
        ...json,
        valid: isValid,
        errors: errors,
        retry_count: retryCount,
        data: parsed || {},
        raw_ai_text: rawAiText
      }
    });
  }

  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    processValidateAiOutput
  };
}

if (typeof $input !== 'undefined') {
  return processValidateAiOutput($input.all());
}
