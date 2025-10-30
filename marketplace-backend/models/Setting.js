import mongoose from 'mongoose';

const SettingSchema = new mongoose.Schema({
  siteName: { type: String, default: 'Marketplace' },
  allowRegistration: { type: Boolean, default: true },
  requireEmailVerification: { type: Boolean, default: false },
  enableReviews: { type: Boolean, default: true },
  maxImagesPerProduct: { type: Number, default: 5 },
  maxFileSize: { type: Number, default: 5 },
  commissionRate: { type: Number, default: 5 },
  autoApproveProducts: { type: Boolean, default: true },
  enableEscrow: { type: Boolean, default: true },
  maintenanceMode: { type: Boolean, default: false },
  featuredCategories: [String],
  bannedWords: [String],
}, { timestamps: true });

export default mongoose.model('Setting', SettingSchema);
