import express from 'express';
import { auth, isAdmin } from '../middleware/auth.js';
import Setting from '../models/Setting.js';

const router = express.Router();
router.use(auth, isAdmin);

// Get all settings
router.get('/', async (req, res) => {
  try {
    const settings = await Setting.findOne({});
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: 'Failed to load settings', error });
  }
});

// Update settings
router.put('/', async (req, res) => {
  try {
    const data = req.body;
    const settings = await Setting.findOneAndUpdate({}, data, {
      new: true,
      upsert: true
    });
    res.json({ message: 'Settings updated successfully', settings });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update settings', error });
  }
});

export default router;
