(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PanelReplyIntake = factory();
})(globalThis, function () {
  'use strict';

  // This local fallback recognizes explicit fields and common phrases. It is not
  // an AI model, an address verifier, an emergency classifier or a booking engine.
  const FIELD_NAMES = ['job', 'zip', 'timing'];
  const MAX_MESSAGE_LENGTH = 2000;

  function normalize(text) {
    return typeof text === 'string' ? text.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim() : '';
  }

  function isOptOut(text) {
    if (typeof text !== 'string') return false;
    const prepare = value => normalize(value).replace(/^please\s*,\s*/i, 'please ').replace(/,\s*please[.!?]*$/i, '');
    const command = /^(?:(?:please\s+)?(?:stop|unsubscribe|cancel|end|quit)(?:[.!?]*|\s+please[.!?]*)|(?:please\s+)?stop\s+(?:texting|messaging|sending\s+(?:me\s+)?(?:texts?|messages?)|all\s+(?:texts?|messages?))(?:\s+me)?(?:\s+(?:now|again|please))?[.!?]*|(?:please\s+)?(?:do\s+not|don't|dont)\s+(?:text|message|contact)\s+me(?:\s+again)?[.!?]*|(?:please\s+)?remove\s+me(?:\s+from\s+(?:your\s+)?(?:list|messages?))?[.!?]*|(?:please\s+)?no\s+more\s+(?:texts?|messages?)[.!?]*|(?:please\s+)?unsubscribe\s+me(?:\s+please)?[.!?]*|(?:please\s+)?opt\s*out(?:\s+please)?[.!?]*)$/i;
    const bareCommand = /^(?:please\s+)?(?:stop|unsubscribe|cancel|end|quit)(?:\s+please)?[.!?]*$/i;
    if (command.test(prepare(text))) return true;
    // A complete opt-out inside a bundled request still controls the request.
    // Commas only delimit natural opt-out phrases, so "stop, by Thursday" does
    // not become the standalone STOP command.
    for (const clause of text.split(/[.!?]+(?=\s|$)|[\n\r;]+/)) {
      if (command.test(prepare(clause))) return true;
      for (const part of clause.split(',')) {
        const phrase = prepare(part).replace(/^(?:and|but)\s+/i, '');
        if (!bareCommand.test(phrase) && command.test(phrase)) return true;
      }
    }
    return false;
  }

  function isStart(text) {
    return /^(?:start|unstop)[.!]?$/i.test(normalize(text));
  }

  function isUrgent(text) {
    return /\b(?:sparks?|sparking|arcing|arc flash|electrical fire|on fire|smoke\b(?!\s+(?:detector|alarm)s?\b)|smoking|burning (?:smell|odor|wire|outlet|panel)|smell (?:something |of )?burning|downed (?:wire|power ?line)|power lines? (?:(?:is|are|has|have) )?(?:fell|fallen|down|collapsed|hanging)|live (?:exposed )?wire|exposed (?:live|energized) wire|electric(?:al)? shock|shocked|electrocuted|zapped|hot (?:outlet|panel)|(?:outlet|socket|breaker|breaker box|fuse box|panel|wires?|cord|plug).{0,35}?(?:melting\b(?!\s+(?:pot|point|wax)\b)|overheating|sizzling|smoldering|smouldering|caught fire|in flames|smells? (?:like )?(?:it'?s )?burning)|(?:flames?|melting|overheating|sizzling|smoldering|smouldering).{0,40}?(?:outlet|socket|breaker|breaker box|fuse box|panel|wires?|cord|plug))\b/i.test(normalize(text));
  }

  function cleanPhrase(text) {
    return text.trim().replace(/^[\s,;:.!?-]+|[\s,;:.!?-]+$/g, '')
      .replace(/^(?:and|also|then)\s+/i, '').replace(/\s+(?:and|or|in|at|on|for|by|with)$/i, '').trim();
  }

  function maskRanges(text, ranges) {
    const chars = text.split('');
    for (const [start, end] of ranges) {
      for (let index = start; index < end; index++) {
        if (!/[\n;,!.?]/.test(chars[index])) chars[index] = ' ';
      }
    }
    return chars.join('');
  }

  function findZip(text) {
    const values = [];
    const ranges = [];
    let ambiguous = false;
    const labelled = /\b(?:(?:my|our|the|job|correct|new)\s+)*(?:zip(?:\s*code)?|postal\s*code)\b\s*(?:(?:is|should\s+be|to)\s+)?[:=#]?\s*([a-z0-9-]+)/gi;
    for (const match of text.matchAll(labelled)) {
      ranges.push([match.index, match.index + match[0].length]);
      if (/^\d{5}$/.test(match[1])) values.push(match[1]);
      else ambiguous = true;
    }

    const phones = [...text.matchAll(/\+?\d[\d\s().-]{7,}\d/g)].map(match => [match.index, match.index + match[0].length]);
    for (const match of text.matchAll(/\b\d{5}(?:-\d{4})?\b/g)) {
      const start = match.index;
      const end = start + match[0].length;
      if (ranges.some(([a, b]) => start >= a && start < b)) continue;
      if (phones.some(([a, b]) => start >= a && start < b)) continue;
      const before = text.slice(Math.max(0, start - 45), start);
      const after = text.slice(end, end + 90);
      if (/[\d-]/.test(text[start - 1] || '') || /[\d-]/.test(text[end] || '')) continue;
      if (/(?:\$\s*|\b(?:budget|cost|price|quote|usd|phone|telephone|mobile|tel|address)(?:\s+(?:is|number|of))*\s*[:=]?\s*|\b(?:call|text|reach|contact)\s+(?:me|us)\s+(?:at|on)\s*)$/i.test(before)) continue;
      if (/^\s*(?:watts?|kw|volts?|amps?|btu|dollars?|usd)\b/i.test(after)) continue;
      if (/^\s+[a-z][a-z .'’-]{0,45}\s+(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|court|ct|drive|dr|circle|cir|way|terrace|ter|trail|trl|parkway|pkwy)\b/i.test(after)) continue;
      if (match[0].includes('-')) {
        ambiguous = true;
        ranges.push([start, end]);
        continue;
      }
      values.push(match[0]);
      const locationPrefix = before.match(/\b(?:in|at|near|located\s+in)\s+$/i);
      ranges.push([locationPrefix ? start - locationPrefix[0].length : start, end]);
    }
    // A standalone ZIP+4 is rejected even though its digit pattern resembles a phone number.
    if (/^\s*\d{5}-\d{4}\s*$/.test(text)) ambiguous = true;
    const unique = [...new Set(values)];
    if (unique.length > 1) ambiguous = true;
    return { value: !ambiguous && unique.length === 1 ? unique[0] : null, ranges, ambiguous };
  }

  const TIME_CUE = /\b(?:today|tomorrow|tonight|(?:next|this)\s+(?:week(?:end)?|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekdays?|weekends?|morning|afternoon|evening|asap|as\s+soon\s+as\s+possible|anytime|any\s+(?:day|time)|flexible|after\s+work|during\s+business\s+hours|in\s+\d+\s+(?:days?|weeks?|months?)|(?:after|before|around|at|from|between)\s+\d{1,2}(?::\d{2})?(?!\d)|\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m|p\.m)|(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])(?:\/\d{2,4})?)\b/i;
  const JOB_CUE = /\b(?:(?:i|we)\s+(?:need|want)|(?:install|repair|replace|fix|upgrade|wire|rewire|inspect|troubleshoot|add|move)\b|(?:job|work|request)\s*:)/i;
  const JOB_CORRECTION = /^\s*(?:(?:actually|correction)\b\s*[,;:]?\s*|(?:change|update|correct)\s+(?:the\s+|my\s+)?(?:job|work|request)\s*(?:to|:)\s*)/i;

  function splitTiming(clause) {
    const labelled = clause.match(/\b(?:my\s+)?(?:timing|availability|callback(?:\s+time)?|preferred(?:\s+callback)?\s+time)\s*[:=]\s*/i);
    if (labelled) {
      const valueStart = labelled.index + labelled[0].length;
      const following = clause.slice(valueStart);
      const nextJob = following.match(JOB_CUE);
      const end = nextJob ? valueStart + nextJob.index : clause.length;
      const timing = cleanPhrase(clause.slice(valueStart, end));
      return { job: clause.slice(0, labelled.index) + ' ' + clause.slice(end), timing: /[a-z0-9]/i.test(timing) ? timing : null };
    }
    const cue = clause.match(TIME_CUE);
    if (!cue) return { job: clause, timing: null };
    let start = cue.index;
    const prefix = clause.slice(0, start);
    const lead = prefix.match(/\b(?:(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:call(?:\s+me|\s+us)?(?:\s+back)?|reach\s+me|contact\s+me|stop\s+by|come\s+(?:by|over)|visit)|(?:my\s+)?(?:timing|availability|callback(?:\s+time)?)(?:\s+is)?\s*[:=]?|(?:i(?:'m|\s+am)|we(?:'re|\s+are))\s+available)\s*(?:on\s+)?$/i);
    if (lead) start -= lead[0].length;
    else {
      const preposition = prefix.match(/\b(?:on|by|for)\s+$/i);
      if (preposition) start -= preposition[0].length;
    }
    const following = clause.slice(cue.index + cue[0].length);
    const nextJob = following.match(JOB_CUE);
    const end = nextJob ? cue.index + cue[0].length + nextJob.index : clause.length;
    return { job: clause.slice(0, start) + ' ' + clause.slice(end), timing: cleanPhrase(clause.slice(start, end)) };
  }

  function meaningfulJob(text) {
    const normalized = normalize(text);
    if (!/[a-z]/i.test(normalized)) return false;
    if (/^(?:a|an|the|my|our|your|is|in|at|to)$/i.test(normalized)) return false;
    if (/^(?:(?:hi|hello|hey|thanks|thank\s+you|ok|okay|yes|no|please|and|or|also|actually|correction)[.!\s,]*)+$/i.test(normalized)) return false;
    if (/^(?:(?:i(?:'m|\s+am)|we(?:'re|\s+are))\s+(?:in|at)|(?:my|the|our)\s+(?:zip|zip\s*code|postal\s*code)(?:\s+is)?)$/i.test(normalized)) return false;
    if (/^(?:my\s+|the\s+)?(?:phone|telephone|mobile|address|budget|price|cost)\b/i.test(normalized) && !JOB_CUE.test(normalized)) return false;
    if (/^(?:what|which|why|how)\b/i.test(normalized) && !JOB_CUE.test(normalized)) return false;
    return true;
  }

  function extractFields(message, currentFields) {
    const result = { job: null, zip: null, timing: null, ambiguous: false };
    if (typeof message !== 'string' || !message.trim()) return result;
    if (message.length > MAX_MESSAGE_LENGTH) return { ...result, ambiguous: true };
    if (isOptOut(message) || isStart(message) || isUrgent(message)) return result;
    const current = mergeFields({}, currentFields);
    const zip = findZip(message);
    result.zip = zip.value;
    result.ambiguous = zip.ambiguous;
    const remaining = maskRanges(message, zip.ranges);
    const jobParts = [];
    const timingParts = [];
    let correction = false;
    for (const raw of remaining.split(/[.!?](?=\s|$)|[\n;,]+/)) {
      let clause = raw.trim();
      if (!clause) continue;
      if (JOB_CORRECTION.test(clause) || /^(?:job|work|request)\s*:/i.test(clause)) correction = true;
      clause = clause.replace(JOB_CORRECTION, '').replace(/^(?:job|work|request)\s*:\s*/i, '');
      const parts = splitTiming(clause);
      if (parts.timing && /[a-z0-9]/i.test(parts.timing)) timingParts.push(parts.timing);
      const job = cleanPhrase(parts.job);
      if (meaningfulJob(job)) jobParts.push(job);
    }
    if (timingParts.length) result.timing = timingParts.join('. ');
    if (jobParts.length && (!current.job || correction)) result.job = jobParts.join('. ');
    return result;
  }

  function mergeFields(current, extracted) {
    const result = { job: '', zip: '', timing: '' };
    for (const source of [current, extracted]) {
      if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
      for (const key of FIELD_NAMES) {
        if (!Object.prototype.hasOwnProperty.call(source, key) || typeof source[key] !== 'string') continue;
        const value = source[key].trim();
        if (!value || value.length > MAX_MESSAGE_LENGTH) continue;
        if (key === 'zip' ? /^\d{5}$/.test(value) : /[a-z0-9]/i.test(value)) result[key] = value;
      }
    }
    return result;
  }

  function missingFields(fields) {
    const validated = mergeFields({}, fields);
    return FIELD_NAMES.filter(key => !validated[key]);
  }

  return Object.freeze({ normalize, isOptOut, isStart, isUrgent, extractFields, mergeFields, missingFields });
});
