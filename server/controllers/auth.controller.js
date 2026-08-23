import * as svc from '../services/auth.service.js';

export const registerCtrl = async (req, res, next) => {
  try { res.status(201).json(await svc.register(req.body.email, req.body.password)); }
  catch (e) { next(e); }
};

export const loginCtrl = async (req, res, next) => {
  try { res.json(await svc.login(req.body.email, req.body.password)); }
  catch (e) { next(e); }
};
