// Backend utils/notifications.js - Simple notification system
const notifications = []; // In-memory storage (use Redis or DB in production)

class NotificationService {
  static addNotification(userId, message, type = 'info') {
    const notification = {
      id: Date.now().toString(),
      userId,
      message,
      type, // 'info', 'success', 'warning', 'error'
      read: false,
      createdAt: new Date()
    };
    
    notifications.push(notification);
    
    // Keep only last 100 notifications per user
    const userNotifications = notifications.filter(n => n.userId === userId);
    if (userNotifications.length > 100) {
      const toRemove = userNotifications.slice(0, userNotifications.length - 100);
      toRemove.forEach(notif => {
        const index = notifications.indexOf(notif);
        if (index > -1) notifications.splice(index, 1);
      });
    }
    
    return notification;
  }
  
  static getUserNotifications(userId, unreadOnly = false) {
    let userNotifications = notifications.filter(n => n.userId === userId);
    
    if (unreadOnly) {
      userNotifications = userNotifications.filter(n => !n.read);
    }
    
    return userNotifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  
  static markAsRead(userId, notificationId) {
    const notification = notifications.find(n => 
      n.id === notificationId && n.userId === userId
    );
    
    if (notification) {
      notification.read = true;
      return true;
    }
    
    return false;
  }
  
  static markAllAsRead(userId) {
    notifications
      .filter(n => n.userId === userId)
      .forEach(n => n.read = true);
  }
}

module.exports = NotificationService;