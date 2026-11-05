/**
 * Date Generator — generate realistic birthdates for signup
 * 
 * Usage:
 *   import { generateBirthdate } from './utils/date-generator.js';
 *   const { day, month, year } = generateBirthdate(18, 35);
 */

/**
 * Generate random birthdate within age range
 * @param {number} minAge - Minimum age (default: 18)
 * @param {number} maxAge - Maximum age (default: 45)
 * @returns {{day: string, month: string, year: string, date: string}}
 */
export function generateBirthdate(minAge = 18, maxAge = 45) {
  const currentYear = new Date().getFullYear();
  const minYear = currentYear - maxAge;
  const maxYear = currentYear - minAge;
  
  // Random year between min and max age
  const year = Math.floor(Math.random() * (maxYear - minYear + 1)) + minYear;
  
  // Random month (1-12)
  const month = Math.floor(Math.random() * 12) + 1;
  
  // Random day based on month
  const daysInMonth = new Date(year, month, 0).getDate();
  const day = Math.floor(Math.random() * daysInMonth) + 1;
  
  return {
    day: day.toString(),
    month: month.toString(),
    year: year.toString(),
    date: `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
  };
}

/**
 * Generate random gender
 * @returns {'male'|'female'}
 */
export function generateGender() {
  return Math.random() > 0.5 ? 'male' : 'female';
}

/**
 * Get month name from number
 * @param {number|string} month - Month number (1-12)
 * @returns {string}
 */
export function getMonthName(month) {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];
  return months[parseInt(month) - 1];
}

/**
 * Wait/delay helper
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Random delay between min and max
 * @param {number} min - Minimum milliseconds
 * @param {number} max - Maximum milliseconds
 * @returns {Promise<void>}
 */
export async function randomDelay(min = 1000, max = 3000) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  await sleep(delay);
}
