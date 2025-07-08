const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    isPremium: { type: Boolean, default: false },
    premiumUntil: { type: Date } // data de expirare
});

module.exports = mongoose.model('User', userSchema);
