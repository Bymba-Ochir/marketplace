// Backend routes/orders.js - Escrow-like order management
const express = require('express');
const Order = require('../models/Order');
const Product = require('../models/Product');
const { auth } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

const router = express.Router();

// Create order (simulates escrow)
router.post('/', auth, [
  body('productId').isMongoId().withMessage('Invalid product ID'),
  body('shippingAddress.street').notEmpty().withMessage('Street address is required'),
  body('shippingAddress.city').notEmpty().withMessage('City is required'),
  body('shippingAddress.state').notEmpty().withMessage('State is required'),
  body('shippingAddress.zipCode').notEmpty().withMessage('Zip code is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { productId, shippingAddress, notes } = req.body;

    // Check if product exists and is available
    const product = await Product.findById(productId).populate('sellerId');
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (product.status !== 'available') {
      return res.status(400).json({ message: 'Product is not available' });
    }

    if (product.sellerId._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot purchase your own product' });
    }

    // Create order
    const order = new Order({
      productId,
      buyerId: req.user._id,
      sellerId: product.sellerId._id,
      amount: product.price,
      shippingAddress,
      notes,
      paymentStatus: 'escrowed' // Simulate payment in escrow
    });

    await order.save();

    // Mark product as pending
    await Product.findByIdAndUpdate(productId, { status: 'pending' });

    await order.populate(['productId', 'buyerId', 'sellerId']);
    res.status(201).json(order);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's orders
router.get('/my-orders', auth, async (req, res) => {
  try {
    const { type = 'all' } = req.query; // 'purchases', 'sales', 'all'

    let query = {};
    if (type === 'purchases') {
      query.buyerId = req.user._id;
    } else if (type === 'sales') {
      query.sellerId = req.user._id;
    } else {
      query.$or = [
        { buyerId: req.user._id },
        { sellerId: req.user._id }
      ];
    }

    const orders = await Order.find(query)
      .populate('productId')
      .populate('buyerId', 'username email')
      .populate('sellerId', 'username email')
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update order status (seller confirms shipment)
router.put('/:id/ship', auth, [
  body('trackingNumber').optional().isLength({ min: 1 }).withMessage('Tracking number required')
], async (req, res) => {
  try {
    const { trackingNumber } = req.body;
    
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Only seller can mark as shipped
    if (order.sellerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (order.status !== 'confirmed') {
      return res.status(400).json({ message: 'Order must be confirmed before shipping' });
    }

    order.status = 'shipped';
    if (trackingNumber) {
      order.trackingNumber = trackingNumber;
    }
    
    await order.save();
    await order.populate(['productId', 'buyerId', 'sellerId']);
    
    res.json(order);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Confirm delivery (buyer confirms receipt)
router.put('/:id/confirm-delivery', auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Only buyer can confirm delivery
    if (order.buyerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (order.status !== 'shipped') {
      return res.status(400).json({ message: 'Order must be shipped before delivery confirmation' });
    }

    // Complete the order and release payment from escrow
    order.status = 'completed';
    order.paymentStatus = 'released';
    await order.save();

    // Mark product as sold
    await Product.findByIdAndUpdate(order.productId, { status: 'sold' });

    await order.populate(['productId', 'buyerId', 'sellerId']);
    res.json(order);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Cancel order
router.put('/:id/cancel', auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Only buyer or seller can cancel
    const canCancel = order.buyerId.toString() === req.user._id.toString() || 
                     order.sellerId.toString() === req.user._id.toString();
    
    if (!canCancel) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (['completed', 'cancelled'].includes(order.status)) {
      return res.status(400).json({ message: 'Cannot cancel this order' });
    }

    order.status = 'cancelled';
    order.paymentStatus = 'refunded';
    await order.save();

    // Mark product as available again
    await Product.findByIdAndUpdate(order.productId, { status: 'available' });

    await order.populate(['productId', 'buyerId', 'sellerId']);
    res.json(order);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;