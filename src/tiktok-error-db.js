'use strict';

// TikTok error patterns database untuk detection dan recovery
// Berdasarkan pengalaman real dari berbagai failure scenario

const TIKTOK_ERROR_DATABASE = {
  // Rate limiting errors
  'error_code_7': {
    pattern: /error_code.*7|Frekuensi kunjungan|terlalu sering|Batas percobaan/i,
    severity: 'high',
    recovery: 'rotate_proxy',
    delay: 3600000, // 1 hour
    description: 'IP rate limited - terlalu banyak percobaan dari IP yang sama'
  },
  
  // IP blocking
  'ip_ban': {
    pattern: /blocked|banned|diblokir|restricted|access.*denied/i,
    severity: 'critical', 
    recovery: 'change_ip_subnet',
    delay: 86400000, // 24 hours
    description: 'IP sepenuhnya diblokir TikTok - perlu subnet berbeda'
  },
  
  // Captcha challenges
  'captcha': {
    pattern: /captcha|verify|human.*verification|robot.*check/i,
    severity: 'medium',
    recovery: 'change_fingerprint',
    delay: 1800000, // 30 minutes
    description: 'Captcha detected - fingerprint terdeteksi sebagai automation'
  },
  
  // Device fingerprint banning
  'device_ban': {
    pattern: /device.*ban|browser.*block|fingerprint.*detect|machine.*id/i,
    severity: 'critical',
    recovery: 'full_reset',
    delay: 432000000, // 5 days
    description: 'Device/browser fingerprint diblokir - perlu reset lengkap'
  },
  
  // Phone verification required
  'phone_required': {
    pattern: /phone.*required|nomor.*telepon|sms.*verification|mobile.*number/i,
    severity: 'medium',
    recovery: 'switch_method',
    delay: 0,
    description: 'Phone verification required - coba method email instead'
  },
  
  // Email domain restrictions
  'email_domain': {
    pattern: /email.*domain|domain.*not.*allowed|invalid.*domain|email.*rejected/i,
    severity: 'low',
    recovery: 'change_email_domain',
    delay: 0,
    description: 'Email domain tidak diterima - ganti domain email'
  },
  
  // Session/token errors
  'session_expired': {
    pattern: /session.*expired|token.*invalid|login.*required/i,
    severity: 'low',
    recovery: 'refresh_session',
    delay: 0,
    description: 'Session expired - perlu refresh cookies/session'
  },
  
  // Network/connection issues
  'network_error': {
    pattern: /network.*error|connection.*failed|timeout|socket.*closed/i,
    severity: 'low',
    recovery: 'retry_later',
    delay: 300000, // 5 minutes
    description: 'Network connectivity issue - coba lagi nanti'
  },
  
  // Unknown errors
  'unknown': {
    pattern: /.*/,
    severity: 'unknown',
    recovery: 'wait',
    delay: 1800000, // 30 minutes
    description: 'Error tidak dikenali - tunggu sebelum retry'
  }
};

// Recovery strategies
const RECOVERY_STRATEGIES = {
  'rotate_proxy': {
    action: 'proxy_rotation',
    description: 'Rotasi proxy ke yang fresh',
    priority: 1
  },
  'change_ip_subnet': {
    action: 'ip_subnet_change', 
    description: 'Ganti seluruh IP subnet',
    priority: 2
  },
  'change_fingerprint': {
    action: 'fingerprint_change',
    description: 'Ubah browser fingerprint',
    priority: 3
  },
  'full_reset': {
    action: 'complete_reset',
    description: 'Reset lengkap device/browser',
    priority: 4
  },
  'switch_method': {
    action: 'method_switch',
    description: 'Ganti method pendaftaran',
    priority: 5
  },
  'change_email_domain': {
    action: 'email_domain_switch',
    description: 'Ganti domain email',
    priority: 6
  },
  'refresh_session': {
    action: 'session_refresh',
    description: 'Refresh session/cookies',
    priority: 7
  },
  'retry_later': {
    action: 'delayed_retry',
    description: 'Coba lagi setelah delay',
    priority: 8
  },
  'wait': {
    action: 'wait_only',
    description: 'Tunggu saja',
    priority: 9
  }
};

/**
 * Detect TikTok error type dari error message
 */
function detectTikTokError(errorMessage) {
  for (const [errorType, config] of Object.entries(TIKTOK_ERROR_DATABASE)) {
    if (config.pattern.test(errorMessage)) {
      return {
        type: errorType,
        severity: config.severity,
        description: config.description,
        recovery: config.recovery
      };
    }
  }
  return {
    type: 'unknown',
    severity: 'unknown',
    description: 'Error tidak dikenali',
    recovery: 'wait'
  };
}

/**
 * Get recovery strategy untuk error type
 */
function getRecoveryStrategy(errorType) {
  const recoveryType = TIKTOK_ERROR_DATABASE[errorType]?.recovery || 'wait';
  return {
    action: RECOVERY_STRATEGIES[recoveryType].action,
    description: RECOVERY_STRATEGIES[recoveryType].description,
    priority: RECOVERY_STRATEGIES[recoveryType].priority,
    delay: TIKTOK_ERROR_DATABASE[errorType]?.delay || 1800000
  };
}

/**
 * Generate recovery plan berdasarkan error
 */
function generateRecoveryPlan(errorResult) {
  const strategy = getRecoveryStrategy(errorResult.type);
  
  return {
    errorType: errorResult.type,
    severity: errorResult.severity,
    description: errorResult.description,
    recoveryAction: strategy.action,
    recoveryDescription: strategy.description,
    recoveryPriority: strategy.priority,
    recommendedDelay: strategy.delay,
    timestamp: new Date().toISOString(),
    suggestedSteps: generateRecoverySteps(strategy.action)
  };
}

/**
 * Generate detailed recovery steps
 */
function generateRecoverySteps(action) {
  const steps = {
    'proxy_rotation': [
      '1. Test proxy baru dengan test-tiktok-access.js',
      '2. Pastikan proxy residential Indonesia',
      '3. Update account dengan proxy baru',
      '4. Tunggu 1 jam sebelum retry'
    ],
    'ip_subnet_change': [
      '1. Ganti seluruh IP subnet (bukan hanya proxy)',
      '2. Gunakan mobile data/different ISP',
      '3. Tunggu 24 jam untuk cooling period',
      '4. Test dengan IP baru sebelum create'
    ],
    'fingerprint_change': [
      '1. Ubah user agent dan viewport',
      '2. Rotasi fingerprint settings',
      '3. Clear browser cache dan storage',
      '4. Tunggu 30 menit sebelum retry'
    ],
    'complete_reset': [
      '1. Full reset browser/data',
      '2. Ganti device fingerprint completely',
      '3. Tunggu 5 days cooling period',
      '4. Start dengan setup全新'
    ]
  };
  
  return steps[action] || ['1. Tunggu dan coba lagi nanti'];
}

module.exports = {
  TIKTOK_ERROR_DATABASE,
  RECOVERY_STRATEGIES,
  detectTikTokError,
  getRecoveryStrategy,
  generateRecoveryPlan,
  generateRecoverySteps
};