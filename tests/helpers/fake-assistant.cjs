'use strict';

// Deliberately small, deterministic adapter for synthetic integration fixtures.
// This is not a model, not a production parser and not a live provider client.
function createFakeAssistantProvider({ delayMs = 0 } = {}) {
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 15000) throw new Error('Invalid fixture delay.');
  const calls = [];
  return {
    kind: 'fake', calls,
    async generate(context, { signal } = {}) {
      calls.push(structuredClone(context));
      if (delayMs) await new Promise((resolve, reject) => {
        const cancel = () => { clearTimeout(timer); reject(new Error('Synthetic generation cancelled.')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, delayMs);
        if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
      });
      const message = context.data.message;
      if (message === 'Simulate provider failure') throw new Error('Synthetic provider outage.');
      if (message === 'Simulate malformed provider output') return '{invalid';
      const changes = [];
      const add = (field, value, evidence, operation = 'set') => changes.push({ field, value, evidence, operation });
      const correction = /\b(?:Actually|Correction|instead|change|update)\b/i.test(message) ? 'correct' : 'set';
      const name = message.match(/(?:I'm|I am|My name is|Name:)\s+([\p{L}]+(?:[ '-][\p{L}]+){1,3})/u);
      if (name) add('customerName', name[1], name[0], correction);
      const phone = message.match(/(?:(?:Phone:|My phone is|Call me at)\s+)?(\d{3}-555-01\d{2})/);
      if (phone) add('phone', phone[1], phone[0], correction);
      const zip = message.match(/\b(?:ZIP\s*:?\s*)?(48315|48084|48104)\b/);
      if (zip) add('zip', zip[1], zip[0], correction);
      const job = message.match(/(?:I need|I want)\s+(?:(?:a|an)\s+)?([^.!?]+(?:upgrade|charger|lighting|generator|outlet|panel|repair)(?:\s+(?:installed|installation|replaced|repair))?)/i);
      if (job) add('job', job[1], job[0], correction);
      const date = message.match(/(?:Can you do|Work date:|I need the work done)\s+(Saturday|Friday|Monday|next week)/i);
      if (date) add('requestedWorkDate', date[1], date[0], correction);
      const callback = message.match(/(?:Call me|Callback:)\s+((?:Monday|Tuesday|Friday|Saturday)?\s*(?:after\s+\d\s*pm|tomorrow))/i);
      if (callback) add('callbackWindow', callback[1].trim(), callback[0], correction);
      const last = context.data.history.findLast(item => item.role === 'assistant')?.text || '';
      if (!changes.length && /^What is the customer name\?$/.test(last) && /^[\p{L}]+(?:[ '-][\p{L}]+)+$/u.test(message)) add('customerName', message, message);
      if (!changes.length && /^What is the callback window\?$/.test(last) && /^after \d\s*pm$/i.test(message)) add('callbackWindow', message, message);
      const answerTopics = [];
      if (/\bhours\b/i.test(message)) answerTopics.push('hours');
      if (/\b(?:price|cost|pricing)\b/i.test(message)) answerTopics.push('pricing');
      return { changes, clarify: [], answerTopics, intent: /\b(?:human|person)\b/i.test(message) ? 'handoff' : /\b(?:summary|summarize)\b/i.test(message) ? 'summary' : 'continue' };
    }
  };
}

module.exports = { createFakeAssistantProvider };
