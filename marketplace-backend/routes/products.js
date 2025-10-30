const express = require('express');
const { body, validationResult } = require('express-validator');
const Product = require('../models/Product');
const User = require('../models/User');
const { auth, isSeller, isOwner } = require('../middleware/auth');
const { upload, handleMulterError } = require('../middleware/upload');

const router = express.Router();

// @route   GET /api/products
// @desc    Get all products with search, filter, and pagination
// @access  Public
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 12,
      search,
      category,
      minPrice,
      maxPrice,
      condition,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      sellerId
    } = req.query;

    // Build query
    const query = { status: 'available' };

    // Search in title and description
    if (search) {
      query.$text = { $search: search };
    }

    // Filter by category
    if (category && category !== 'all') {
      query.category = category;
    }

    // Filter by price range
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    // Filter by condition
    if (condition) {
      query.condition = condition;
    }

    // Filter by seller
    if (sellerId) {
      query.sellerId = sellerId;
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute query with pagination
    const skip = (Number(page) - 1) * Number(limit);
    
    const [products, total] = await Promise.all([
      Product.find(query)
        .populate('sellerId', 'username ratings')
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
    console.error('Get products error:', error);
    res.status(500).json({ message: 'Server error fetching products' });
  }
});

// @route   GET /api/products/:id
// @desc    Get single product by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('sellerId', 'username email ratings avatar')
      .populate('buyerId', 'username');

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Increment views
    await Product.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } });

    res.json({ product });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ message: 'Server error fetching product' });
  }
});

// @route   POST /api/products
// @desc    Create a new product
// @access  Private (Seller)
router.post('/', [
  auth,
  isSeller,
  upload.array('images', 5),
  handleMulterError,
  body('title')
    .isLength({ min: 1, max: 100 })
    .withMessage('Title is required and must be less than 100 characters'),
  body('description')
    .isLength({ min: 1, max: 1000 })
    .withMessage('Description is required and must be less than 1000 characters'),
  body('price')
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  body('category')
    .isIn(['Electronics', 'Clothing', 'Home & Garden', 'Sports', 'Books', 'Automotive', 'Health & Beauty', 'Toys', 'Other'])
    .withMessage('Please select a valid category'),
  body('condition')
    .isIn(['new', 'like-new', 'good', 'fair', 'poor'])
    .withMessage('Please select a valid condition')
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

    // Check if images were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'At least one image is required' });
    }

    const { title, description, price, category, condition, location } = req.body;
    
    // Get image paths
    const images = req.files.map(file => file.filename);

    // Create new product
    const product = new Product({
      title,
      description,
      price: Number(price),
      category,
      condition,
      location,
      images,
      sellerId: req.user._id
    });

    await product.save();
    await product.populate('sellerId', 'username ratings');

    res.status(201).json({
      message: 'Product created successfully',
      product
    });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ message: 'Server error creating product' });
  }
});

// @route   PUT /api/products/:id
// @desc    Update a product
// @access  Private (Owner)
router.put('/:id', [
  auth,
  isSeller,
  upload.array('images', 5),
  handleMulterError,
  body('title')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Title must be less than 100 characters'),
  body('description')
    .optional()
    .isLength({ min: 1, max: 1000 })
    .withMessage('Description must be less than 1000 characters'),
  body('price')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  body('category')
    .optional()
    .isIn(['Electronics', 'Clothing', 'Home & Garden', 'Sports', 'Books', 'Automotive', 'Health & Beauty', 'Toys', 'Other'])
    .withMessage('Please select a valid category'),
  body('condition')
    .optional()
    .isIn(['new', 'like-new', 'good', 'fair', 'poor'])
    .withMessage('Please select a valid condition')
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

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Check ownership
    if (product.sellerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied. You are not the owner.' });
    }

    // Update fields
    const updateData = { ...req.body };
    
    // Handle new images
    if (req.files && req.files.length > 0) {
      updateData.images = req.files.map(file => file.filename);
    }

    // Convert price to number if provided
    if (updateData.price) {
      updateData.price = Number(updateData.price);
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('sellerId', 'username ratings');

    res.json({
      message: 'Product updated successfully',
      product: updatedProduct
    });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ message: 'Server error updating product' });
  }
});

// @route   DELETE /api/products/:id
// @desc    Delete a product
// @access  Private (Owner)
router.delete('/:id', auth, isSeller, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Check ownership
    if (product.sellerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied. You are not the owner.' });
    }

    // Check if product is sold or pending
    if (product.status === 'sold' || product.status === 'pending') {
      return res.status(400).json({ message: 'Cannot delete a sold or pending product' });
    }

    await Product.findByIdAndDelete(req.params.id);

    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ message: 'Server error deleting product' });
  }
});

// @route   POST /api/products/:id/purchase
// @desc    Purchase a product (escrow simulation)
// @access  Private (Buyer)
router.post('/:id/purchase', auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Check if product is available
    if (product.status !== 'available') {
      return res.status(400).json({ message: 'Product is not available for purchase' });
    }

    // Check if user is trying to buy their own product
    if (product.sellerId.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot purchase your own product' });
    }

    // Update product status to pending
    product.status = 'pending';
    product.buyerId = req.user._id;
    await product.save();

    res.json({
      message: 'Purchase initiated. Product is now pending confirmation.',
      product
    });
  } catch (error) {
    console.error('Purchase product error:', error);
    res.status(500).json({ message: 'Server error processing purchase' });
  }
});

// @route   POST /api/products/:id/confirm-purchase
// @desc    Confirm purchase completion (buyer confirms)
// @access  Private (Buyer)
router.post('/:id/confirm-purchase', auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Check if user is the buyer
    if (!product.buyerId || product.buyerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied. You are not the buyer.' });
    }

    // Check if product is pending
    if (product.status !== 'pending') {
      return res.status(400).json({ message: 'Product is not in pending status' });
    }

    // Mark as sold
    product.status = 'sold';
    await product.save();

    res.json({
      message: 'Purchase confirmed successfully. Product is now sold.',
      product
    });
  } catch (error) {
    console.error('Confirm purchase error:', error);
    res.status(500).json({ message: 'Server error confirming purchase' });
  }
});

// @route   POST /api/products/:id/cancel-purchase
// @desc    Cancel purchase (buyer or seller can cancel)
// @access  Private
router.post('/:id/cancel-purchase', auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Check if user is buyer or seller
    const isBuyer = product.buyerId && product.buyerId.toString() === req.user._id.toString();
    const isSeller = product.sellerId.toString() === req.user._id.toString();
    
    if (!isBuyer && !isSeller) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    // Check if product is pending
    if (product.status !== 'pending') {
      return res.status(400).json({ message: 'Product is not in pending status' });
    }

    // Reset to available
    product.status = 'available';
    product.buyerId = null;
    await product.save();

    res.json({
      message: 'Purchase cancelled successfully. Product is now available again.',
      product
    });
  } catch (error) {
    console.error('Cancel purchase error:', error);
    res.status(500).json({ message: 'Server error cancelling purchase' });
  }
});

module.exports = router;