(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PanelReplyBusinessInfo = factory();
})(globalThis, function () {
  'use strict';

  // Only add verified, public business information here. This file is included
  // in the public page. Never put credentials or customer information in it.
  // Each answer must be approved before verified is changed to true. Empty or
  // unverified answers stay unknown. These facts do not enable booking or calls.
  const unknown = () => Object.freeze({ verified: false, answer: '' });
  return Object.freeze({
    services: unknown(),
    pricing: unknown(),
    estimates: unknown(),
    hours: unknown(),
    serviceArea: unknown(),
    contact: unknown(),
    qualifications: unknown(),
    emergencyAvailability: unknown(),
    permits: unknown(),
    warranty: unknown(),
    financing: unknown()
  });
});
