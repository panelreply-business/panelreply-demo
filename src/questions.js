(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./business-info.js'));
  else root.PanelReplyQuestions = factory(root.PanelReplyBusinessInfo);
})(globalThis, function (defaultFacts) {
  'use strict';

  // Saved answers only. This module does not call a model or change the request.
  // Question text selects a topic, never a fact or an instruction to execute.
  const FIELD_NAMES = ['job', 'zip', 'timing'];
  const UNKNOWN = 'I do not have a verified answer to that question yet. I can help with this request, how this chat works, and business details once they are confirmed.';
  const FALLBACKS = Object.freeze({
    services: 'I do not have a verified list of the contractor\'s services yet. I can collect an electrical-work enquiry for the contractor to review.',
    pricing: 'I do not have verified pricing for this work yet. The contractor needs to review the job before confirming a quote.',
    estimates: 'I do not have verified estimate terms yet, including whether an estimate is free. The contractor needs to confirm them.',
    hours: 'I do not have verified business hours yet. You can leave a callback preference for the contractor to confirm.',
    serviceArea: 'I do not have a verified service area yet. The contractor needs to confirm whether they cover the job location.',
    contact: 'I do not have verified contact details for the contractor yet. This preview does not contact anyone.',
    qualifications: 'I do not have verified licensing, insurance or qualification details yet. Ask the contractor to provide them before agreeing to work.',
    emergencyAvailability: 'I do not have verified emergency or after-hours availability yet.',
    permits: 'I do not have verified permit arrangements for this job yet. The contractor needs to confirm them.',
    warranty: 'I do not have verified warranty or guarantee terms yet. The contractor needs to confirm them.',
    financing: 'I do not have verified financing or payment terms yet. The contractor needs to confirm them.'
  });

  function normalize(value) {
    return typeof value === 'string' ? value.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim() : '';
  }

  function fact(topic, approvedFacts) {
    if (!approvedFacts || typeof approvedFacts !== 'object' || Array.isArray(approvedFacts)
      || !Object.hasOwn(approvedFacts, topic)) return FALLBACKS[topic];
    const entry = approvedFacts[topic];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || !Object.hasOwn(entry, 'verified') || entry.verified !== true
      || !Object.hasOwn(entry, 'answer') || typeof entry.answer !== 'string') return FALLBACKS[topic];
    const value = entry.answer.trim();
    return value && value.length <= 1000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
      ? value : FALLBACKS[topic];
  }

  function requestState(fields) {
    const result = { job: '', zip: '', timing: '', needsConfirmation: [] };
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return result;
    for (const key of FIELD_NAMES) {
      if (!Object.hasOwn(fields, key) || typeof fields[key] !== 'string') continue;
      const value = fields[key].trim();
      if (!value || value.length > 500) continue;
      if (key === 'zip' ? /^\d{5}$/.test(value) : /[a-z0-9]/i.test(value)) result[key] = value;
    }
    if (Object.hasOwn(fields, 'needsConfirmation') && Array.isArray(fields.needsConfirmation)) {
      result.needsConfirmation = FIELD_NAMES.filter(key => fields.needsConfirmation.includes(key));
    }
    return result;
  }

  function fieldAnswer(key, state) {
    const label = { job: 'electrical work', zip: 'job ZIP', timing: 'callback preference' }[key];
    const value = state[key];
    if (state.needsConfirmation.includes(key)) {
      return value
        ? 'The request currently shows ' + label + ': ' + value + '. This still needs confirmation.'
        : 'The ' + label + ' still needs confirmation. I do not have a confirmed value yet.';
    }
    if (!value) return 'You have not provided the ' + label + ' yet.';
    return 'Your recorded ' + label + ' is ' + value + '.' + (key === 'timing' ? ' No appointment is booked.' : '');
  }

  function summaryAnswer(state) {
    const lines = FIELD_NAMES.map(key => {
      const label = { job: 'Electrical work', zip: 'Job ZIP', timing: 'Callback preference' }[key];
      const value = state[key] || 'Not provided';
      return label + ': ' + value + (state.needsConfirmation.includes(key) ? ' (needs confirmation)' : '');
    });
    return 'Here is the request so far.\n' + lines.join('\n') + '\nNo appointment is booked.';
  }

  function topicsFor(question) {
    const text = normalize(question).toLowerCase();
    const topics = [];
    const add = topic => { if (!topics.includes(topic)) topics.push(topic); };
    const recall = /\b(?:did|have|do)\s+i\s+(?:give|tell|say|provide|enter|choose|request|pick|supply|ask)\b/.test(text)
      || /\b(?:i\s+(?:gave|told|said|provided|entered|chose|requested|picked|supplied)|you\s+(?:recorded|collected|noted))\b/.test(text)
      || /\b(?:what|which|when)\b.*\b(?:my|our|recorded|current)\b/.test(text);
    if (recall) {
      if (/\b(?:zip|postal\s*code)\b/.test(text)) add('requestZip');
      if (/\b(?:timing|callback|time|day|date|when|call)\b/.test(text)) add('requestTiming');
      if (/\b(?:job|work|repair|installation)\b/.test(text)) add('requestJob');
      if (!topics.length && /\b(?:give|gave|tell|told|say|said|provide|provided|enter|entered|ask|asked|request|requested|pick|picked|choose|chose|supply|supplied|recorded|collected|noted)\b/.test(text)) add('requestSummary');
    }
    if (/\b(?:summary|summari[sz]e|recap|so far)\b/.test(text)
      || /\bwhat\b.*\b(?:details|information)\b.*\b(?:have|got|collected|recorded)\b/.test(text)) add('requestSummary');

    if (/\b(?:book(?:ing|ed)?|appointments?|calendar|reserv(?:e|ed|ation)|reschedul(?:e|ing))\b/.test(text)) add('booking');
    if (/\b(?:privacy|private|database|reload|refresh|retention|persist)\b/.test(text)
      || /\b(?:sav(?:e|ed|ing)|stor(?:e|ed|ing)|keep|kept|retain)\b.*\b(?:my|our|request|details|data|information|messages?|conversation)\b/.test(text)
      || /\b(?:my|our|request|details|data|information|messages?|conversation)\b.*\b(?:sav(?:e|ed)|stor(?:e|ed)|kept|retained)\b/.test(text)) add('privacy');
    if (/\b(?:reset|start over|clear (?:this|the|my) (?:page|request|conversation))\b/.test(text)) add('reset');
    if (/\b(?:stop|start|unsubscribe|opt[ -]?out|pause)\b/.test(text)
      && /\b(?:mean|means|do|does|work|works|reply|replies|text|texts|message|messages|button|command|resume)\b/.test(text)) add('controls');
    if (/\b(?:all|every|several|multiple|together|at once|one message|same message|everything)\b/.test(text)
      && /\b(?:details|information|info|message|send|give|tell|enter|include)\b/.test(text)) add('bundled');
    if (/\b(?:correct|correction|change|update|edit|wrong|mistake)\b/.test(text)
      && /\b(?:zip|job|work|timing|callback|detail|details|request|summary|you)\b/.test(text)) add('corrections');
    if (/\bhow\s+(?:does|do|can)\s+(?:this|it|the chat|the app|panelreply|i use this)\b.*\b(?:work|use|help)\b/.test(text)
      || /\bwhat\b.*\b(?:details|information|info)\b.*\b(?:need|include|provide|send|enter)\b/.test(text)
      || /\bhow\s+(?:do|can)\s+i\s+(?:get started|use (?:this|the chat|the app))\b/.test(text)) add('howItWorks');
    if (/\b(?:are|is)\s+(?:you|this|the chat)\s+(?:an?\s+)?(?:ai|human|chatbot|robot)\b/.test(text)
      || /\b(?:use|using)\b.*\b(?:ai|artificial intelligence)\b/.test(text)) add('answerMode');
    if (/\b(?:can|could|do|will)\s+you\s+answer\b/.test(text)) add('questionHelp');

    const asksContact = /\b(?:phone|telephone|number|email|e-mail|contact details|contact information|website|address)\b/.test(text)
      || /\b(?:how (?:do|can) i (?:contact|reach|get in touch)|where are you (?:located|based))\b/.test(text);
    if (asksContact) add('contact');
    else if (/\b(?:notify|notified|notifications?|dispatch|dispatched)\b/.test(text)
      || /\b(?:did|will|can|could|do|does|have|has)\s+(?:you|this|it|the chat|the app)\b.*\b(?:send|sent|call|called|text|texted|message|messaged|contact|contacted|reach|reached)\b/.test(text)
      || /\b(?:send|sent)\b.*\b(?:customer|contractor|electrician|someone|anyone|notifications?|emails?|texts?)\b/.test(text)) add('messaging');

    const estimate = /\bestimates?\b/.test(text);
    if (estimate) add('estimates');
    else if (/\b(?:cost|costs|price|prices|pricing|charge|charges|rates?|fees?|quotes?|expensive)\b/.test(text) || /\bhow much\b/.test(text)) add('pricing');
    const emergency = /\b(?:emergenc(?:y|ies)|after[ -]hours|out.of.hours)\b/.test(text) || /\b24\s*(?:\/|[- ]?\s*)7\b/.test(text);
    const hoursText = text.replace(/\b(?:after[ -]hours|out.of.hours)\b/g, '');
    if (/\bhours\b|\b(?:opening|closing)\s+(?:time|times)\b/.test(hoursText)
      || /\b(?:are|is|will)\b.*\b(?:open|closed)\b/.test(text)
      || /\b(?:do|does)\s+(?:you|the office|the business)\s+(?:open|close)\b/.test(text)
      || /\b(?:when|what time)\b.*\b(?:open|close)\b/.test(text)) add('hours');
    if (emergency) add('emergencyAvailability');
    else if (/\b(?:available|availability|slots?|fit me in)\b/.test(text)
      || /\b(?:an?|any|the next)\s+openings?\b/.test(text)
      || /\b(?:can|could|will|when)\b.*\b(?:come (?:out|by|over)|visit)\b/.test(text)) add('availability');
    const area = /\b(?:service area|coverage|cover|serve|serving)\b/.test(text)
      || /\bservic(?:e|ing)\b.*\b(?:\d{5}|area|location|city|town|zip)\b/.test(text)
      || /\b(?:work in|travel to|come to)\b/.test(text);
    if (area) add('serviceArea');
    else if (/\b(?:what|which)\b.*\bservices?\b/.test(text)
      || /\bwhat\s+(?:work\s+)?do\s+you\s+(?:do|offer|provide)\b/.test(text)
      || (!emergency && /\b(?:do|can|will)\s+you\b.*\b(?:offer|provide)\b.*\b(?:electrical work|services?)\b/.test(text))
      || /\b(?:can|could|would|will|do)\s+you\b.*\b(?:install|repair|replace|fix|upgrade|wire|rewire|inspect|troubleshoot|add|move|service|work on)\b/.test(text)) add('services');
    if (/\b(?:licen[cs](?:e|ed|ing)|insured|insurance|bonded|qualifications?|certifi(?:ed|cation))\b/.test(text)) add('qualifications');
    if (/\b(?:permits?|code compliance)\b/.test(text)) add('permits');
    if (/\b(?:warrant(?:y|ies)|guarantee|guaranteed)\b/.test(text)) add('warranty');
    if (/\b(?:financ(?:e|ing)|payment plans?|payments?|pay in|pay by|instalments?|installments?|credit cards?)\b/.test(text)
      || /\baccept\b.*\b(?:cash|cards?|checks?|cheques?)\b/.test(text)) add('financing');
    return topics.length ? topics : ['unknown'];
  }

  function topicAnswer(topic, state, approvedFacts) {
    if (Object.hasOwn(FALLBACKS, topic)) {
      return fact(topic, approvedFacts) + (topic === 'emergencyAvailability'
        ? ' This chat does not dispatch an electrician or contact emergency services.' : '');
    }
    switch (topic) {
      case 'requestJob': return fieldAnswer('job', state);
      case 'requestZip': return fieldAnswer('zip', state);
      case 'requestTiming': return fieldAnswer('timing', state);
      case 'requestSummary': return summaryAnswer(state);
      case 'booking': return 'This preview does not book appointments or check a calendar. It collects callback preferences. A contractor still needs to confirm availability and arrange the appointment. Changing the sample booking status does not reserve a time.';
      case 'availability': return 'I cannot check live availability. I can record a callback preference, but the contractor must confirm it. No appointment is booked.';
      case 'messaging': return 'This preview does not send calls, texts, emails or notifications, and it does not dispatch an electrician. Messages and the missed-call control demonstrate the workflow on this page.';
      case 'privacy': return 'This preview does not save requests to a customer database. Reloading or resetting clears the page state. If the optional AI connection is used, the current message and request details are sent to its provider.';
      case 'reset': return 'Use Reset tour to clear this conversation, the sample request and the entered test access code. Reloading also clears the page state.';
      case 'controls': return 'STOP pauses automated replies in this preview. START resumes them unless there is a safety hold. Reset tour clears the page. This preview does not keep opt-out status after a reload.';
      case 'bundled': return 'Yes. You can put the electrical work, five-digit job ZIP and callback preference in one message, or send them separately. Each message can contain up to 500 characters.';
      case 'corrections': return 'State the field and its correction, for example: "Actually the job ZIP is 48084" or "Call me Monday after 5 pm instead". Review the request details afterward. If details conflict, confirm the field the chat asks about.';
      case 'howItWorks': return 'Describe the electrical work, give the five-digit job ZIP and add a callback preference. This preview collects those details into a request summary and asks about missing or conflicting information. It does not contact anyone or book an appointment.';
      case 'answerMode': return 'These question answers use saved information and the details in this request. They are not live AI responses.';
      case 'questionHelp': return 'I can answer common questions about this request, how the chat works, and verified business details. I will say when I do not have an answer.';
      default: return UNKNOWN;
    }
  }

  function answer(questions, fields, approvedFacts = defaultFacts) {
    if (!Array.isArray(questions)) return '';
    const state = requestState(fields);
    const topics = [];
    for (const question of questions.slice(0, 32)) {
      if (typeof question !== 'string' || !question.trim() || question.length > 2000) continue;
      for (const topic of topicsFor(question)) if (!topics.includes(topic)) topics.push(topic);
    }
    return [...new Set(topics.map(topic => topicAnswer(topic, state, approvedFacts)))].join('\n\n');
  }

  return Object.freeze({ answer });
});
