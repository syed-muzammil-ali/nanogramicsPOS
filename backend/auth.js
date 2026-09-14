/**
 * BACKEND AUTH SERVICE
 * Password hashing and verification using bcryptjs
 * NOTE: This is the Node.js/Electron main-process file — NOT the frontend auth.js
 */

const bcrypt = require('bcryptjs');

class AuthService {
  constructor() {
    this.saltRounds = 10;
  }

  async hashPassword(password) {
    if (!password || password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }
    const salt = await bcrypt.genSalt(this.saltRounds);
    return await bcrypt.hash(password, salt);
  }

  hashPasswordSync(password) {
    if (!password || password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }
    return bcrypt.hashSync(password, this.saltRounds);
  }

  async verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash);
  }
}

module.exports = AuthService;