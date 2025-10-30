const express = require('express');
const { body, validationResult } = require('express-validator');
const Review = require('../models/Review');
const Product = require('../models/Product');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Helper function to update product ratings
const updateProductRatings = async (productId) => {
  const reviews = await Review.find({ productId });
  const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
  const averageRating = reviews.length > 0 ? totalRating / reviews.length : 0;
  
  await Product.findByIdAndUpdate(productId, {
    'ratings.average': averageRating,
    'ratings.count': reviews.length
  });
};

// Helper function to update seller ratings
const updateSellerRatings = async (sellerId) => {
  const reviews = await Review.find({ sellerId });
  const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
  const averageRating = reviews.length > 0 ? totalRating / reviews.length : 0;
  
  await User.findByIdAndUpdate(sellerId, {
    'ratings.average': averageRating,
    'ratings.count': reviews.length
  });
};

// @route   POST /api/reviews
// @desc    Create a new review
// @access  Private
router.post('/', [
  auth,
  body('productId')
    .isMongoId()
    .withMessage('Invalid product ID'),
  body('rating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5'),
  body('comment')
    .isLength({ min: 1, max: 500 })
    .withMessage('Comment is required and must be less than 500 characters'),
  body('reviewType')
    .optional()
    .isIn(['product', 'seller'])
    .withMessage('Review type must be product or seller')
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const { productId, rating, comment, reviewType = 'product' } = req.body;

    // Check if product exists
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Check if user purchased the product
    if (product.buyerId?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You can only review products you have purchased' });
    }

    // Check if product is sold
    if (product.status !== 'sold') {
      return res.status(400).json({ message: 'You can only review completed purchases' });
    }

    // Check if user already reviewed this product
    const existingReview = await Review.findOne({
      productId,
      userId: req.user._id
    });

    if (existingReview) {
      return res.status(400).json({ message: 'You have already reviewed this product' });
    }

    // Create new review
    const review = new Review({
      productId,
      userId: req.user._id,
      sellerId: product.sellerId,
      rating,
      comment,
      reviewType
    });

    await review.save();
    await review.populate([
      { path: 'userId', select: 'username avatar' },
      { path: 'productId', select: 'title images' },
      { path: 'sellerId', select: 'username' }
    ]);

    // Update product and seller ratings
    await Promise.all([
      updateProductRatings(productId),
      updateSellerRatings(product.sellerId)
    ]);

    res.status(201).json({
      message: 'Review created successfully',
      review
    });
  } catch (error) {
    console.error('Create review error:', error);
    res.status(500).json({ message: 'Server error creating review' });
  }
});

// @route   GET /api/reviews
// @desc    Get reviews with filters
// @access  Public
router.get('/', async (req, res) => {
  try {
    const {
      productId,
      sellerId,
      userId,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = {};
    if (productId) query.productId = productId;
    if (sellerId) query.sellerId = sellerId;
    if (userId) query.userId = userId;

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute query with pagination
    const skip = (Number(page) - 1) * Number(limit);
    
    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate('userId', 'username avatar')
        .populate('productId', 'title images')
        .populate('sellerId', 'username')
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
    console.error('Get reviews error:', error);
    res.status(500).json({ message: 'Server error fetching reviews' });
  }
});

// @route   GET /api/reviews/:id
// @desc    Get single review by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const review = await Review.findById(req.params.id)
      .populate('userId', 'username avatar')
      .populate('productId', 'title images')
      .populate('sellerId', 'username');

    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    res.json({ review });
  } catch (error) {
    console.error('Get review error:', error);
    res.status(500).json({ message: 'Server error fetching review' });
  }
});

// @route   PUT /api/reviews/:id
// @desc    Update a review
// @access  Private (Owner only)
router.put('/:id', [
  auth,
  body('rating')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5'),
  body('comment')
    .optional()
    .isLength({ min: 1, max: 500 })
    .withMessage('Comment must be less than 500 characters')
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    // Check ownership
    if (review.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied. You are not the owner.' });
    }

    const { rating, comment } = req.body;
    const updateData = {};
    if (rating) updateData.rating = rating;
    if (comment) updateData.comment = comment;

    const updatedReview = await Review.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate([
      { path: 'userId', select: 'username avatar' },
      { path: 'productId', select: 'title images' },
      { path: 'sellerId', select: 'username' }
    ]);

    // Update product and seller ratings if rating was changed
    if (rating) {
      await Promise.all([
        updateProductRatings(review.productId),
        updateSellerRatings(review.sellerId)
      ]);
    }

    res.json({
      message: 'Review updated successfully',
      review: updatedReview
    });
  } catch (error) {
    console.error('Update review error:', error);
    res.status(500).json({ message: 'Server error updating review' });
  }
});

// @route   DELETE /api/reviews/:id
// @desc    Delete a review
// @access  Private (Owner only)
router.delete('/:id', auth, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    // Check ownership
    if (review.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied. You are not the owner.' });
    }

    const { productId, sellerId } = review;
    
    await Review.findByIdAndDelete(req.params.id);

    // Update product and seller ratings
    await Promise.all([
      updateProductRatings(productId),
      updateSellerRatings(sellerId)
    ]);

    res.json({ message: 'Review deleted successfully' });
  } catch (error) {
    console.error('Delete review error:', error);
    res.status(500).json({ message: 'Server error deleting review' });
  }
});

module.exports = router;