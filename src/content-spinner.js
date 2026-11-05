'use strict';

const db = require('./db');

/**
 * Content Variation & Spinning System
 * Generates unique variations of content to avoid detection
 */

class ContentSpinner {
  constructor() {
    this.emojis = {
      happy: ['😊', '😃', '😄', '🙂', '😁', '🤗'],
      love: ['❤️', '💕', '💖', '💗', '💓', '💝'],
      fire: ['🔥', '💥', '⚡', '✨', '🌟', '💫'],
      thumbs: ['👍', '👏', '🙌', '👌', '✌️', '🤝'],
      celebration: ['🎉', '🎊', '🥳', '🎈', '🎁', '🏆'],
      nature: ['🌸', '🌺', '🌻', '🌷', '🌹', '🌼'],
      food: ['🍕', '🍔', '🍟', '🍰', '🎂', '🍪'],
      drink: ['☕', '🍵', '🥤', '🍹', '🧃', '🥛']
    };
  }

  /**
   * Parse spintax: {option1|option2|option3}
   */
  parseSpintax(text) {
    const regex = /\{([^{}]+)\}/g;
    let result = text;
    
    while (regex.test(result)) {
      result = result.replace(regex, (match, group) => {
        const options = group.split('|');
        return options[Math.floor(Math.random() * options.length)];
      });
      regex.lastIndex = 0; // Reset regex for nested spintax
    }
    
    return result;
  }

  /**
   * Replace variables: {{name}}, {{date}}, {{time}}
   */
  replaceVariables(text, variables = {}) {
    let result = text;
    
    // Default variables
    const defaults = {
      date: new Date().toLocaleDateString('id-ID'),
      time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
      day: new Date().toLocaleDateString('id-ID', { weekday: 'long' }),
      month: new Date().toLocaleDateString('id-ID', { month: 'long' }),
      year: new Date().getFullYear().toString()
    };
    
    const allVars = { ...defaults, ...variables };
    
    for (const [key, value] of Object.entries(allVars)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
      result = result.replace(regex, value);
    }
    
    return result;
  }

  /**
   * Add random emojis
   */
  addEmojis(text, category = null, count = 1) {
    const emojiList = category && this.emojis[category] 
      ? this.emojis[category]
      : Object.values(this.emojis).flat();
    
    const selectedEmojis = [];
    for (let i = 0; i < count; i++) {
      const emoji = emojiList[Math.floor(Math.random() * emojiList.length)];
      selectedEmojis.push(emoji);
    }
    
    return text + ' ' + selectedEmojis.join(' ');
  }

  /**
   * Shuffle words (careful mode - keeps sentence structure)
   */
  shuffleWords(text) {
    const sentences = text.split(/([.!?]+)/);
    const shuffled = [];
    
    for (let i = 0; i < sentences.length; i += 2) {
      const sentence = sentences[i].trim();
      const punctuation = sentences[i + 1] || '';
      
      if (sentence) {
        const words = sentence.split(' ');
        // Only shuffle middle words, keep first and last
        if (words.length > 3) {
          const first = words[0];
          const last = words[words.length - 1];
          const middle = words.slice(1, -1);
          
          // Fisher-Yates shuffle
          for (let j = middle.length - 1; j > 0; j--) {
            const k = Math.floor(Math.random() * (j + 1));
            [middle[j], middle[k]] = [middle[k], middle[j]];
          }
          
          shuffled.push([first, ...middle, last].join(' ') + punctuation);
        } else {
          shuffled.push(sentence + punctuation);
        }
      }
    }
    
    return shuffled.join(' ');
  }

  /**
   * Generate multiple variations
   */
  generateVariations(text, options = {}) {
    const {
      count = 1,
      useSpintax = true,
      addEmoji = false,
      emojiCategory = null,
      emojiCount = 1,
      shuffle = false,
      variables = {}
    } = options;
    
    const variations = [];
    
    for (let i = 0; i < count; i++) {
      let variation = text;
      
      // Parse spintax
      if (useSpintax) {
        variation = this.parseSpintax(variation);
      }
      
      // Replace variables
      variation = this.replaceVariables(variation, variables);
      
      // Shuffle words
      if (shuffle && Math.random() > 0.5) {
        variation = this.shuffleWords(variation);
      }
      
      // Add emojis
      if (addEmoji) {
        variation = this.addEmojis(variation, emojiCategory, emojiCount);
      }
      
      variations.push(variation);
    }
    
    return variations;
  }

  /**
   * Synonym replacement (basic)
   */
  replaceSynonyms(text) {
    const synonyms = {
      'bagus': ['keren', 'mantap', 'hebat', 'luar biasa', 'oke banget'],
      'senang': ['gembira', 'bahagia', 'girang', 'suka', 'happy'],
      'terima kasih': ['thanks', 'makasih', 'tengkyu', 'thank you'],
      'sangat': ['amat', 'sekali', 'banget', 'super'],
      'hari ini': ['today', 'sekarang', 'kini'],
      'selamat': ['congrats', 'congratulations', 'happy'],
    };
    
    let result = text;
    
    for (const [word, synonymList] of Object.entries(synonyms)) {
      if (Math.random() > 0.6) { // 40% chance to replace
        const synonym = synonymList[Math.floor(Math.random() * synonymList.length)];
        const regex = new RegExp(word, 'gi');
        result = result.replace(regex, synonym);
      }
    }
    
    return result;
  }

  /**
   * Add random spacing/punctuation variations
   */
  varyPunctuation(text) {
    // Random spacing after punctuation
    text = text.replace(/([.!?])/g, (match) => {
      const spaces = Math.random() > 0.5 ? ' ' : '  ';
      return match + spaces;
    });
    
    // Random capitalization after punctuation
    text = text.replace(/([.!?]\s+)(\w)/g, (match, punct, char) => {
      return punct + (Math.random() > 0.2 ? char.toUpperCase() : char);
    });
    
    return text.trim();
  }
}

/**
 * Content Template Manager
 */
class TemplateManager {
  constructor() {
    this.templates = [];
  }

  async loadTemplates() {
    await db.waitReady();
    
    // Create templates table if not exists
    db.run(`
      CREATE TABLE IF NOT EXISTS content_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT,
        content TEXT NOT NULL,
        variables TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    
    const templates = await db.rawAll('SELECT * FROM content_templates ORDER BY id DESC');
    this.templates = templates;
    return templates;
  }

  async addTemplate(name, content, category = null, variables = []) {
    await db.waitReady();
    
    db.run(
      'INSERT INTO content_templates (name, category, content, variables) VALUES (?, ?, ?, ?)',
      [name, category, content, JSON.stringify(variables)]
    );
    
    const id = db.lastInsertId();
    db.save();
    
    await this.loadTemplates();
    return id;
  }

  async getTemplate(id) {
    await db.waitReady();
    const template = await db.rawAll('SELECT * FROM content_templates WHERE id = ?', [id]);
    
    if (template[0]) {
      template[0].variables = JSON.parse(template[0].variables || '[]');
    }
    
    return template[0] || null;
  }

  async updateTemplate(id, updates) {
    await db.waitReady();
    
    const fields = [];
    const values = [];
    
    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.category !== undefined) {
      fields.push('category = ?');
      values.push(updates.category);
    }
    if (updates.content !== undefined) {
      fields.push('content = ?');
      values.push(updates.content);
    }
    if (updates.variables !== undefined) {
      fields.push('variables = ?');
      values.push(JSON.stringify(updates.variables));
    }
    
    fields.push('updated_at = datetime("now")');
    values.push(id);
    
    db.run(
      `UPDATE content_templates SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
    
    db.save();
    await this.loadTemplates();
  }

  async deleteTemplate(id) {
    await db.waitReady();
    db.run('DELETE FROM content_templates WHERE id = ?', [id]);
    db.save();
    await this.loadTemplates();
  }

  async getTemplatesByCategory(category) {
    await db.waitReady();
    const templates = await db.rawAll(
      'SELECT * FROM content_templates WHERE category = ? ORDER BY id DESC',
      [category]
    );
    
    return templates.map(t => ({
      ...t,
      variables: JSON.parse(t.variables || '[]')
    }));
  }
}

module.exports = {
  ContentSpinner: new ContentSpinner(),
  TemplateManager: new TemplateManager()
};
