'use strict';

// Review only. No timer, deletion, policy default or customer content export.
function createRetentionReview({ db, now, getActor, StoreError, callbackTasksEnabled = true }) {
  const fail = (status, code, message) => { throw new StoreError(status, code, message); };
  return function reviewRetention(actor, input) {
    getActor(actor);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2 || !Object.hasOwn(input, 'before') || !Object.hasOwn(input, 'limit') || !Number.isSafeInteger(input.before) || input.before < 0 || input.before > 8640000000000000 || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) fail(400, 'invalid_retention_review', 'Supply an explicit cutoff timestamp and a review limit from 1 to 500.');
    const at = now();
    if (!Number.isSafeInteger(at) || at < 0 || at > 8640000000000000) fail(503, 'clock_unavailable', 'Check the workspace clock before reviewing retention.');
    if (input.before > at) fail(400, 'invalid_retention_review', 'The review cutoff cannot be in the future.');
    // A single read snapshot binds counts, versions and dependencies. Never use
    // the write transaction helper for a review or materialize personal fields.
    db.exec('BEGIN');
    try {
      const leadWhere = "business_id=? AND status='closed' AND updated_at<? AND coalesce(json_extract(data_json,'$.safetyHold'),1)=0" + (callbackTasksEnabled ? " AND NOT EXISTS (SELECT 1 FROM callback_tasks t WHERE t.lead_id=leads.id AND t.business_id=leads.business_id AND t.status='scheduled')" : '');
      const projectWhere = 'business_id=? AND updated_at<?';
      const requests = db.prepare('SELECT id,version,updated_at AS updatedAt,(SELECT count(*) FROM messages m WHERE m.lead_id=leads.id AND m.business_id=leads.business_id) AS messageCount FROM leads WHERE ' + leadWhere + ' ORDER BY updated_at,id LIMIT ?').all(actor.businessId, input.before, input.limit).map(row => ({ ...row }));
      const projects = db.prepare('SELECT id,version,updated_at AS updatedAt,(SELECT count(*) FROM panel_sources s WHERE s.project_id=panel_projects.id AND s.business_id=panel_projects.business_id) AS sourceCount FROM panel_projects WHERE ' + projectWhere + ' ORDER BY updated_at,id LIMIT ?').all(actor.businessId, input.before, input.limit).map(row => ({ ...row }));
      const requestTotal = db.prepare('SELECT count(*) AS n FROM leads WHERE ' + leadWhere).get(actor.businessId, input.before).n;
      const projectTotal = db.prepare('SELECT count(*) AS n FROM panel_projects WHERE ' + projectWhere).get(actor.businessId, input.before).n;
      db.exec('COMMIT');
      return { mode: 'review-only', generatedAt: new Date(at).toISOString(), before: new Date(input.before).toISOString(), limitPerCategory: input.limit, requests: { total: requestTotal, truncated: requestTotal > requests.length, records: requests }, projects: { total: projectTotal, truncated: projectTotal > projects.length, records: projects } };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
}

module.exports = { createRetentionReview };
