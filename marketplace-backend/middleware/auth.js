const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verify JWT token
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'Access denied. No token provided.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ message: 'Invalid token. User not found.' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token.' });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired.' });
    }
    res.status(500).json({ message: 'Server error during authentication.' });
  }
};

// Check if user is admin
const isAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied. Admin role required.' });
  }
  next();
};

// Check if user is seller or owner
const isSeller = (req, res, next) => {
  if (req.user.role !== 'seller' && req.user.role !== 'both') {
    return res.status(403).json({ message: 'Access denied. Seller role required.' });
  }
  next();
};

// Check if user is buyer or owner
const isBuyer = (req, res, next) => {
  if (req.user.role !== 'buyer' && req.user.role !== 'both') {
    return res.status(403).json({ message: 'Access denied. Buyer role required.' });
  }
  next();
};

// Check if user owns the resource
const isOwner = (Model) => async (req, res, next) => {
  try {
    const resource = await Model.findById(req.params.id);
    if (!resource) {
      return res.status(404).json({ message: 'Resource not found.' });
    }
    
    const userId = resource.userId || resource.sellerId;
    if (userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied. You are not the owner.' });
    }
    
    req.resource = resource;
    next();
  } catch (error) {
    res.status(500).json({ message: 'Server error checking ownership.' });
  }
};

module.exports = {
  auth,
  isAdmin,   // ✅ нэмсэн
  isSeller,
  isBuyer,
  isOwner
};
