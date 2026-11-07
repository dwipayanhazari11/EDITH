/**
 * EDITH Validate Clarification Response (code-nodes/validate_clarify_response.js)
 * 
 * Validates Gemini's structured extraction from free-text clarification replies:
 * - Checks confidence threshold (>= 0.60)
 * - Verifies that either owner or deadline_iso was extracted
 * - Resolves owner handle
 * - Emits valid update payload or polite re-prompt if ambiguous
 */

function processValidateClarify(items, parsedActionContext = {}) {
  const results = [];

  for (const item of items) {
    const json = item.json;

    // Handle extraction from Gemini response
    let extracted = null;
    try {
      if (typeof json === 'object' && json.confidence !== undefined) {
        extracted = json;
      } else if (json.candidates?.[0]?.content?.parts?.[0]?.text) {
        extracted = JSON.parse(json.candidates[0].content.parts[0].text);
      } else if (json.text) {
        extracted = JSON.parse(json.text);
      } else {
        extracted = json;
      }
    } catch (e) {
      extracted = { owner: null, deadline_iso: null, confidence: 0 };
    }

    const taskId = parsedActionContext.task_id || json.task_id || '';
    const chatId = parsedActionContext.chat_id || json.chat_id || '';
    const sender = parsedActionContext.user_handle || '';

    const confidence = typeof extracted?.confidence === 'number' ? extracted.confidence : 0;
    const rawOwner = (extracted?.owner || '').trim();
    const rawDeadline = (extracted?.deadline_iso || '').trim();

    // Check validity: confidence >= 0.60 and at least one entity extracted
    const hasOwner = Boolean(rawOwner && rawOwner.toLowerCase() !== 'null');
    const hasDeadline = Boolean(rawDeadline && /^\d{4}-\d{2}-\d{2}$/.test(rawDeadline));
    const isValid = confidence >= 0.60 && (hasOwner || hasDeadline);

    if (!isValid) {
      results.push({
        json: {
          is_valid: false,
          task_id: taskId,
          chat_id: chatId,
          confidence: confidence,
          retry_message: `⚠️ EDITH could not determine an assignee or deadline from your response.\n\nPlease reply directly with a name (e.g. @username) or a target date (e.g. 2026-11-13).`
        }
      });
    } else {
      let finalOwner = null;
      if (hasOwner) {
        finalOwner = rawOwner.startsWith('@') ? rawOwner : (rawOwner.toLowerCase() === 'me' ? sender : rawOwner);
      }

      results.push({
        json: {
          is_valid: true,
          action_type: 'clarify_reply_resolved',
          task_id: taskId,
          chat_id: chatId,
          new_owner: finalOwner,
          new_deadline: hasDeadline ? rawDeadline : null,
          confidence: confidence
        }
      });
    }
  }

  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    processValidateClarify
  };
}

if (typeof $input !== 'undefined') {
  let actionContext = {};
  try {
    actionContext = $('Parse Update Action').first()?.json || {};
  } catch (e) {
    actionContext = {};
  }
  return processValidateClarify($input.all(), actionContext);
}
