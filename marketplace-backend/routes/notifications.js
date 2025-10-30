// Backend routes/notifications.js
const express = require('express');
const NotificationService = require('../utils/notifications');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Get user notifications
router.get('/', auth, (req, res) => {
  try {
    const { unreadOnly = false } = req.query;
    const notifications = NotificationService.getUserNotifications(
      req.user._id.toString(), 
      unreadOnly === 'true'
    );
    
    res.json(notifications);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark notification as read
router.put('/:id/read', auth, (req, res) => {
  try {
    const success = NotificationService.markAsRead(
      req.user._id.toString(),
      req.params.id
    );
    
    if (success) {
      res.json({ message: 'Notification marked as read' });
    } else {
      res.status(404).json({ message: 'Notification not found' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark all notifications as read
router.put('/mark-all-read', auth, (req, res) => {
  try {
    NotificationService.markAllAsRead(req.user._id.toString());
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;