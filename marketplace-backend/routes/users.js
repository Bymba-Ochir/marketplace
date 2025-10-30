const express = require('express');
const User = require('../models/User');
const Product = require('../models/Product');
const Review = require('../models/Review');
const { auth, isAdmin } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/users/:id
// @desc    Get user profile by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get user's products (only show available ones for public view)
    const productQuery = { sellerId: req.params.id };
    
    // If not the owner or admin, only show available products
    const isOwner = req.user && req.user._id.toString() === req.params.id;
    const isAdminUser = req.user && req.user.role === 'admin';
    
    if (!isOwner && !isAdminUser) {
      productQuery.status = 'available';
    }

    const products = await Product.find(productQuery)
      .sort({ createdAt: -1 })
      .limit(10);

    // Get user's reviews (as seller)
    const reviews = await Review.find({ sellerId: req.params.id })
      .populate('userId', 'username avatar')
      .populate('productId', 'title images')
      .sort({ createdAt: -1 })
      .limit(10);

    // Calculate stats
    const stats = {
      totalProducts: await Product.countDocuments({ sellerId: req.params.id }),
      soldProducts: await Product.countDocuments({ 
        sellerId: req.params.id, 
        status: 'sold' 
      }),
      pendingProducts: await Product.countDocuments({ 
        sellerId: req.params.id, 
        status: 'pending' 
      }),
      totalReviews: await Review.countDocuments({ sellerId: req.params.id }),
      averageRating: user.ratings?.average || 0
    };

    res.json({
      user,
      products,
      reviews,
      stats
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error fetching user' });
  }
});

// @route   GET /api/users/:id/products
// @desc    Get user's listed products
// @access  Public
router.get('/:id/products', async (req, res) => {
  try {
    const { page = 1, limit = 12, status = 'all' } = req.query;
    
    const query = { sellerId: req.params.id };
    
    // If not the owner or admin, only show available products
    const isOwner = req.user && req.user._id.toString() === req.params.id;
    const isAdminUser = req.user && req.user.role === 'admin';
    
    if (!isOwner && !isAdminUser) {
      query.status = 'available';
    } else if (status !== 'all') {
      query.status = status;
    }

    const skip = (Number(page) - 1) * Number(limit);
    
    const [products, total] = await Promise.all([
      Product.find(query)
        .populate('buyerId', 'username')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Product.countDocuments(query)
    ]);

    res.json({
      products,
      pagination: {
        current: Number(page),
        pages: Math.ceil(total / Number(limit)),
        total,
        limit: Number(limit)
      }
    });
  } catch (error) {
    console.error('Get user products error:', error);
    res.status(500).json({ message: 'Server error fetching user products' });
  }
});

// @route   GET /api/users/:id/purchases
// @desc    Get user's purchased products
// @access  Private (Own purchases only or admin)
router.get('/:id/purchases', auth, async (req, res) => {
  try {
    // Users can only see their own purchases, unless they're admin
    const isOwner = req.params.id === req.user._id.toString();
    const isAdminUser = req.user.role === 'admin';
    
    if (!isOwner && !isAdminUser) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { page = 1, limit = 12, status = 'all' } = req.query;
    
    const query = { buyerId: req.params.id };
    if (status !== 'all') {
      query.status = status;
    }

    const skip = (Number(page) - 1) * Number(limit);
    
    const [products, total] = await Promise.all([
      Product.find(query)
        .populate('sellerId', 'username ratings')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Product.countDocuments(query)
    ]);

    res.json({
      products,
      pagination: {
        current: Number(page),
        pages: Math.ceil(total / Number(limit)),
        total,
        limit: Number(limit)
      }
    });
  } catch (error) {
    console.error('Get user purchases error:', error);
    res.status(500).json({ message: 'Server error fetching user purchases' });
  }
});

// @route   PUT /api/users/:id
// @desc    Update user profile
// @access  Private (Own profile only or admin)
router.put('/:id', auth, async (req, res) => {
  try {
    // Users can only update their own profile, unless they're admin
    const isOwner = req.params.id === req.user._id.toString();
    const isAdminUser = req.user.role === 'admin';
    
    if (!isOwner && !isAdminUser) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { username, role, status } = req.body;
    const updateData = {};

    // Handle username update
    if (username) {
      // Check if username is already taken
      const existingUser = await User.findOne({ 
        username, 
        _id: { $ne: req.params.id } 
      });
      
      if (existingUser) {
        return res.status(400).json({ message: 'Username already taken' });
      }
      
      updateData.username = username;
    }

    // Handle role update
    if (role) {
      const allowedRoles = ['buyer', 'seller', 'both'];
      
      // Only admins can assign admin role or modify admin roles
      if (isAdminUser) {
        allowedRoles.push('admin');
      }
      
      if (!allowedRoles.includes(role)) {
        return res.status(400).json({ message: 'Invalid role specified' });
      }
      
      // Prevent regular users from setting admin role
      if (role === 'admin' && !isAdminUser) {
        return res.status(403).json({ message: 'Cannot assign admin role' });
      }
      
      updateData.role = role;
    }

    // Handle status update (admin only)
    if (status !== undefined) {
      if (!isAdminUser) {
        return res.status(403).json({ message: 'Only admins can update user status' });
      }
      
      const allowedStatuses = ['active', 'suspended', 'banned'];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ message: 'Invalid status specified' });
      }
      
      updateData.status = status;
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    res.json({
      message: 'Profile updated successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Server error updating profile' });
  }
});

// @route   GET /api/users/:id/reviews
// @desc    Get reviews for a user (as seller)
// @access  Public
router.get('/:id/reviews', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [reviews, total] = await Promise.all([
      Review.find({ sellerId: req.params.id })
        .populate('userId', 'username avatar')
        .populate('productId', 'title images')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Review.countDocuments({ sellerId: req.params.id })
    ]);

    res.json({
      reviews,
      pagination: {
        current: Number(page),
        pages: Math.ceil(total / Number(limit)),
        total,
        limit: Number(limit)
      }
    });
  } catch (error) {
    console.error('Get user reviews error:', error);
    res.status(500).json({ message: 'Server error fetching user reviews' });
  }
});

// @route   DELETE /api/users/:id
// @desc    Delete user account (admin only)
// @access  Private (Admin)
router.delete('/:id', auth, isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Prevent admin from deleting themselves
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }

    // Prevent deleting other admin users (only super admin should be able to)
    if (user.role === 'admin') {
      return res.status(403).json({ message: 'Cannot delete admin users' });
    }

    // Delete user's products and reviews in a transaction-like manner
    await Promise.all([
      Product.deleteMany({ sellerId: userId }),
      Review.deleteMany({ userId: userId }),
      Review.deleteMany({ sellerId: userId }),
      User.findByIdAndDelete(userId)
    ]);

    res.json({ message: 'User and associated data deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Server error deleting user' });
  }
});

// @route   GET /api/users
// @desc    Get all users (admin only)
// @access  Private (Admin)
router.get('/', auth, isAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      role,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = {};

    if (search) {
      query.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    if (role && role !== 'all') {
      query.role = role;
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const skip = (Number(page) - 1) * Number(limit);

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password')
        .sort(sort)
        .skip(skip)
        .limit(Number(limit)),
      User.countDocuments(query)
    ]);

    res.json({
      users,
      pagination: {
        current: Number(page),
        pages: Math.ceil(total / Number(limit)),
        total,
        limit: Number(limit)
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error fetching users' });
  }
});

module.exports = router;