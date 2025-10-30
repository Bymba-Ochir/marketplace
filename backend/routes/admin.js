const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Product = require('../models/Product');
const Review = require('../models/Review');
const { auth, isAdmin } = require('../middleware/auth');

const router = express.Router();

// Middleware to ensure admin is authenticated
router.use(auth, isAdmin);

// ============================================
// DASHBOARD ENDPOINT
// ============================================
router.get('/dashboard', async (req, res) => {
  try {
    console.log('📊 Fetching admin dashboard data...');

    const [
      totalUsers,
      totalProducts,
      totalReviews,
      soldProducts,
      pendingProducts,
      recentUsers,
      recentProducts,
      topSellers,
      categoryStats,
      monthlyStats
    ] = await Promise.all([
      User.countDocuments(),
      Product.countDocuments(),
      Review.countDocuments(),
      Product.countDocuments({ status: 'sold' }),
      Product.countDocuments({ status: 'pending' }),
      User.find().sort({ createdAt: -1 }).limit(5).select('-password'),
      Product.find().sort({ createdAt: -1 }).limit(5).populate('sellerId', 'username email'),
      User.aggregate([
        {
          $lookup: {
            from: 'products',
            localField: '_id',
            foreignField: 'sellerId',
            as: 'products'
          }
        },
        {
          $addFields: {
            soldCount: {
              $size: {
                $filter: {
                  input: '$products',
                  cond: { $eq: ['$$this.status', 'sold'] }
                }
              }
            }
          }
        },
        { $sort: { soldCount: -1 } },
        { $limit: 5 },
        { $project: { username: 1, email: 1, soldCount: 1, ratings: 1 } }
      ]),
      Product.aggregate([
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      Product.aggregate([
        {
          $match: {
            createdAt: {
              $gte: new Date(Date.now() - 12 * 30 * 24 * 60 * 60 * 1000)
            }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' }
            },
            count: { $sum: 1 },
            revenue: {
              $sum: {
                $cond: [{ $eq: ['$status', 'sold'] }, '$price', 0]
              }
            }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
        { $limit: 12 }
      ])
    ]);

    const revenueData = await Product.aggregate([
      { $match: { status: 'sold' } },
      { $group: { _id: null, totalRevenue: { $sum: '$price' } } }
    ]);

    const totalRevenue = revenueData[0]?.totalRevenue || 0;
    const conversionRate = totalProducts > 0 ? ((soldProducts / totalProducts) * 100).toFixed(2) : 0;

    console.log('✅ Dashboard data fetched successfully');

    res.json({
      stats: {
        totalUsers,
        totalProducts,
        totalReviews,
        soldProducts,
        pendingProducts,
        totalRevenue,
        conversionRate
      },
      recentUsers,
      recentProducts,
      topSellers,
      categoryStats,
      monthlyStats
    });
  } catch (error) {
    console.error('❌ Admin dashboard error:', error);
    res.status(500).json({ message: 'Server error fetching dashboard data', error: error.message });
  }
});

// ============================================
// USER MANAGEMENT ENDPOINTS
// ============================================

// Get all users with filters
router.get('/users', auth, isAdmin, async (req, res) => {
  try {
    console.log('👥 Fetching users with filters:', req.query);

    const {
      page = 1,
      limit = 20,
      search,
      role,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

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

    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const skip = (Number(page) - 1) * Number(limit);

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password')
        .sort(sort)
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      User.countDocuments(query)
    ]);

    const usersWithStats = await Promise.all(
      users.map(async (user) => {
        const productStats = await Product.aggregate([
          { $match: { sellerId: user._id } },
          {
            $group: {
              _id: null,
              totalProducts: { $sum: 1 },
              soldProducts: {
                $sum: { $cond: [{ $eq: ['$status', 'sold'] }, 1, 0] }
              }
            }
          }
        ]);

        return {
          ...user,
          productStats: productStats[0] || { totalProducts: 0, soldProducts: 0 }
        };
      })
    );

    console.log(`✅ Fetched ${users.length} users`);

    res.json({
      users: usersWithStats,
      pagination: {
        current: Number(page),
        pages: Math.ceil(total / Number(limit)),
        total,
        limit: Number(limit)
      }
    });
  } catch (error) {
    console.error('❌ Get users error:', error);
    res.status(500).json({ message: 'Server error fetching users', error: error.message });
  }
});

// Update user role
router.put('/users/:id/role', [
  auth,
  isAdmin,
  body('role').isIn(['buyer', 'seller', 'both', 'admin']).withMessage('Invalid role')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { role } = req.body;
    console.log(`🔄 Updating user ${req.params.id} role to ${role}`);

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    console.log('✅ User role updated successfully');
    res.json({ message: 'User role updated successfully', user });
  } catch (error) {
    console.error('❌ Update user role error:', error);
    res.status(500).json({ message: 'Server error updating user role', error: error.message });
  }
});

// Update user status
router.put('/users/:id/status', [
  auth,
  isAdmin,
  body('status').isIn(['active', 'suspended', 'banned']).withMessage('Invalid status')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { status } = req.body;
    console.log(`🔄 Updating user ${req.params.id} status to ${status}`);

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    console.log('✅ User status updated successfully');
    res.json({ message: 'User status updated successfully', user });
  } catch (error) {
    console.error('❌ Update user status error:', error);
    res.status(500).json({ message: 'Server error updating user status', error: error.message });
  }
});

// Delete user
router.delete('/users/:id', auth, isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    console.log(`🗑️ Deleting user ${userId}`);

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role === 'admin' && user._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Cannot delete other admin users' });
    }

    await Promise.all([
      Product.deleteMany({ sellerId: userId }),
      Review.deleteMany({ userId: userId }),
      User.findByIdAndDelete(userId)
    ]);

    console.log('✅ User and associated data deleted successfully');
    res.json({ message: 'User and associated data deleted successfully' });
  } catch (error) {
    console.error('❌ Delete user error:', error);
    res.status(500).json({ message: 'Server error deleting user', error: error.message });
  }
});

// ============================================
// PRODUCT MANAGEMENT ENDPOINTS
// ============================================

router.get('/products', auth, isAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      category,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    if (category && category !== 'all') {
      query.category = category;
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const skip = (Number(page) - 1) * Number(limit);

    const [products, total] = await Promise.all([
      Product.find(query)
        .populate('sellerId', 'username email')
        .populate('buyerId', 'username email')
        .sort(sort)
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
    console.error('❌ Get products error:', error);
    res.status(500).json({ message: 'Server error fetching products', error: error.message });
  }
});

router.put('/products/:id/status', [
  auth,
  isAdmin,
  body('status').isIn(['available', 'pending', 'sold', 'suspended']).withMessage('Invalid status')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { status } = req.body;
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).populate('sellerId', 'username email');

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json({ message: 'Product status updated successfully', product });
  } catch (error) {
    console.error('❌ Update product status error:', error);
    res.status(500).json({ message: 'Server error updating product status', error: error.message });
  }
});

router.delete('/products/:id', auth, isAdmin, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    await Review.deleteMany({ productId: req.params.id });
    await Product.findByIdAndDelete(req.params.id);

    res.json({ message: 'Product and associated reviews deleted successfully' });
  } catch (error) {
    console.error('❌ Delete product error:', error);
    res.status(500).json({ message: 'Server error deleting product', error: error.message });
  }
});

// ============================================
// REVIEW MANAGEMENT ENDPOINTS
// ============================================

router.get('/reviews', auth, isAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      rating,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};

    if (rating) {
      query.rating = Number(rating);
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const skip = (Number(page) - 1) * Number(limit);

    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate('userId', 'username email')
        .populate('sellerId', 'username email')
        .populate('productId', 'title images')
        .sort(sort)
        .skip(skip)
        .limit(Number(limit)),
      Review.countDocuments(query)
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
    console.error('❌ Get reviews error:', error);
    res.status(500).json({ message: 'Server error fetching reviews', error: error.message });
  }
});

router.delete('/reviews/:id', auth, isAdmin, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    const { productId, sellerId } = review;
    
    await Review.findByIdAndDelete(req.params.id);

    // Update ratings
    await Promise.all([
      updateProductRatings(productId),
      updateSellerRatings(sellerId)
    ]);

    res.json({ message: 'Review deleted successfully' });
  } catch (error) {
    console.error('❌ Delete review error:', error);
    res.status(500).json({ message: 'Server error deleting review', error: error.message });
  }
});

// Helper functions
const updateProductRatings = async (productId) => {
  const reviews = await Review.find({ productId });
  const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
  const averageRating = reviews.length > 0 ? totalRating / reviews.length : 0;
  
  await Product.findByIdAndUpdate(productId, {
    'ratings.average': averageRating,
    'ratings.count': reviews.length
  });
};

const updateSellerRatings = async (sellerId) => {
  const reviews = await Review.find({ sellerId });
  const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
  const averageRating = reviews.length > 0 ? totalRating / reviews.length : 0;
  
  await User.findByIdAndUpdate(sellerId, {
    'ratings.average': averageRating,
    'ratings.count': reviews.length
  });
};

module.exports = router;