'use strict';

function positiveInteger(value, field = 'id') {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    const error = new Error(`${field} tidak valid`);
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

function platform(value) {
  if (!['fb', 'ig', 'tiktok'].includes(value)) {
    const error = new Error('Platform tidak valid');
    error.statusCode = 400;
    throw error;
  }
  return value;
}

module.exports = { positiveInteger, platform };
