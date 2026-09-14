/**
 * UTILITIES MODULE
 * 
 * Common utility functions used across the application:
 * - Formatting helpers
 * - DOM manipulation
 * - Date/time utilities
 * - Validation helpers
 */

/**
 * Format currency to Pakistani Rupees
 */
function formatCurrency(amount) {
  return Number(amount).toLocaleString('en-PK');
}

/**
 * Format number with commas
 */
function formatNumber(num) {
  return Number(num).toLocaleString();
}

/**
 * Generate unique ID
 */
function generateId(prefix = 'ID') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 9);
  return `${prefix}-${timestamp}-${random}`.toUpperCase();
}

/**
 * Generate short 6-character order ID
 * Format: AB1234 (2 letters + 4 digits)
 */
function generateOrderId() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O to avoid confusion
  const digits  = '0123456789';
  let id = '';
  // 2 random letters
  for (let i = 0; i < 2; i++) {
    id += letters[Math.floor(Math.random() * letters.length)];
  }
  // 4 random digits
  for (let i = 0; i < 4; i++) {
    id += digits[Math.floor(Math.random() * digits.length)];
  }
  return id;
}

/**
 * Get current date in YYYY-MM-DD format
 */
function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get current timestamp
 */
function getCurrentTimestamp() {
  return new Date().toISOString();
}

/**
 * Format date for display
 */
function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-PK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

/**
 * Format date and time
 */
function formatDateTime(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleString('en-PK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * Format time only
 */
function formatTime(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-PK', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Get date difference in days
 */
function getDateDiff(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
}

/**
 * Validate email
 */
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

/**
 * Validate phone (Pakistani format)
 */
function validatePhone(phone) {
  const re = /^(\+92|0)?[1-9]\d{1,14}$/;
  return re.test(phone.replace(/\s+/g, ''));
}

/**
 * Validate SKU (alphanumeric with dash)
 */
function validateSKU(sku) {
  const re = /^[A-Z0-9-]+$/;
  return re.test(sku);
}

/**
 * Parse CSV string
 */
function parseCSV(csv) {
  const rows = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    const nextChar = csv[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === '\n' && !inQuotes) {
      if (current.trim()) {
        rows.push(current.split(',').map(cell => cell.trim()));
      }
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    rows.push(current.split(',').map(cell => cell.trim()));
  }

  return rows;
}

/**
 * Convert array to CSV
 */
function arrayToCSV(headers, rows) {
  let csv = headers.join(',') + '\n';
  rows.forEach(row => {
    csv += row.map(cell => {
      if (typeof cell === 'string' && cell.includes(',')) {
        return `"${cell}"`;
      }
      return cell;
    }).join(',') + '\n';
  });
  return csv;
}

/**
 * Debounce function for event handlers
 */
function debounce(func, delay) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}

/**
 * Throttle function
 */
function throttle(func, limit) {
  let isThrottled = false;
  return function (...args) {
    if (!isThrottled) {
      func.apply(this, args);
      isThrottled = true;
      setTimeout(() => {
        isThrottled = false;
      }, limit);
    }
  };
}

/**
 * Deep clone object
 */
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime());
  if (obj instanceof Array) return obj.map(item => deepClone(item));

  const cloned = {};
  for (let key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  return cloned;
}

/**
 * Merge objects
 */
function mergeObjects(...objects) {
  return Object.assign({}, ...objects);
}

/**
 * Get query parameter from URL
 */
function getQueryParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

/**
 * Truncate text
 */
function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Capitalize first letter
 */
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Convert text to title case
 */
function toTitleCase(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Remove duplicates from array
 */
function uniqueArray(arr, key = null) {
  if (!key) {
    return [...new Set(arr)];
  }
  const seen = new Set();
  return arr.filter(item => {
    const value = item[key];
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

/**
 * Group array by key
 */
function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const group = item[key];
    if (!acc[group]) acc[group] = [];
    acc[group].push(item);
    return acc;
  }, {});
}

/**
 * Sort array of objects
 */
function sortBy(arr, key, order = 'asc') {
  const sorted = [...arr];
  sorted.sort((a, b) => {
    const aVal = a[key];
    const bVal = b[key];
    
    if (typeof aVal === 'string') {
      return order === 'asc' 
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    }
    
    return order === 'asc' ? aVal - bVal : bVal - aVal;
  });
  return sorted;
}

/**
 * Wait/delay helper
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry async function
 */
async function retry(fn, maxAttempts = 3, delay = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxAttempts - 1) throw error;
      await wait(delay);
    }
  }
}

/**
 * Safe JSON parse
 */
function safeJsonParse(json, fallback = {}) {
  try {
    return JSON.parse(json);
  } catch (error) {
    console.error('JSON parse error:', error);
    return fallback;
  }
}

/**
 * Safe JSON stringify
 */
function safeJsonStringify(obj, fallback = '{}') {
  try {
    return JSON.stringify(obj);
  } catch (error) {
    console.error('JSON stringify error:', error);
    return fallback;
  }
}