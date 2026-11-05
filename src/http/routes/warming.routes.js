'use strict';

const express = require('express');
const asyncHandler = require('../async-handler');
const { positiveInteger } = require('../validation');

module.exports = function createWarmingRouter(accountWarming) {
  const router = express.Router();

  router.post('/start/:id', asyncHandler(async (req, res) => {
    res.json(await accountWarming.startWarming(positiveInteger(req.params.id, 'account ID')));
  }));

  router.get('/status/:id', asyncHandler(async (req, res) => {
    res.json(await accountWarming.getWarmingStatus(positiveInteger(req.params.id, 'account ID')));
  }));

  router.get('/accounts', asyncHandler(async (req, res) => {
    res.json(await accountWarming.getAllWarmingAccounts());
  }));

  router.post('/stop/:id', asyncHandler(async (req, res) => {
    await accountWarming.stopWarming(positiveInteger(req.params.id, 'account ID'));
    res.json({ ok: true, message: 'Warming stopped' });
  }));

  return router;
};
