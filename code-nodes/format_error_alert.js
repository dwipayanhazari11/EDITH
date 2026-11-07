/**
 * EDITH Error Alert Formatter
 * 
 * Sanitizes and formats workflow execution errors triggered by Error Trigger.
 * Strips secrets, tokens, and API keys before notifying the admin on Telegram.
 */

const items = $input.all();
const results = [];

for (const item of items) {
  const json = item.json;

  const workflowName = json.workflow?.name || 'Unknown Workflow';
  const executionId = json.execution?.id || 'N/A';
  const nodeName = json.execution?.error?.node?.name || 'Unknown Node';
  let rawErrorMessage = json.execution?.error?.message || 'Unspecified runtime error';

  // Sanitize message: strip potential tokens, passwords, or keys
  const sanitizedError = rawErrorMessage
    .replace(/(?:bot)?\d{9,10}:[A-Za-z0-9_-]{35}/g, '[REDACTED_TELEGRAM_TOKEN]')
    .replace(/(?:AIzaSy|key=)[A-Za-z0-9_-]{30,}/g, '[REDACTED_API_KEY]')
    .replace(/[a-f0-9]{32,64}/gi, (match) => match.length >= 32 ? '[REDACTED_HASH_OR_KEY]' : match);

  const timestamp = new Date(Date.now() + 330 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  const alertMessage = `⚠️ **EDITH System Alert: Workflow Failure**\n\n` +
    `• **Workflow:** ${workflowName}\n` +
    `• **Failed Node:** ${nodeName}\n` +
    `• **Execution ID:** \`${executionId}\`\n` +
    `• **Time (IST):** ${timestamp}\n\n` +
    `**Error Details:**\n\`${sanitizedError}\``;

  results.push({
    json: {
      alert_message: alertMessage,
      workflow_name: workflowName,
      node_name: nodeName,
      execution_id: executionId,
      error_message: sanitizedError
    }
  });
}

return results;
