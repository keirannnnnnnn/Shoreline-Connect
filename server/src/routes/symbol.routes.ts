import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';

const router = Router();

// Cache list of available symbol names
let cachedSymbolsList: string[] = [];

function getSymbolsList(): string[] {
  if (cachedSymbolsList.length === 0) {
    if (fs.existsSync(config.symbolsDir)) {
      const files = fs.readdirSync(config.symbolsDir);
      cachedSymbolsList = files
        .filter(f => f.endsWith('.svg'))
        .map(f => f.replace(/\.svg$/, ''));
    }
  }
  return cachedSymbolsList;
}

/**
 * GET /api/symbols/search?q=...
 */
router.get('/search', (req, res) => {
  const query = (req.query.q as string || '').toLowerCase().trim();
  const limit = parseInt(req.query.limit as string || '60', 10);
  const symbols = getSymbolsList();

  if (!query) {
    return res.json({ symbols: symbols.slice(0, limit), total: symbols.length });
  }

  const matches = symbols.filter(s => s.toLowerCase().includes(query)).slice(0, limit);
  res.json({ symbols: matches, total: matches.length });
});

/**
 * GET /api/symbols/:name
 * Serves raw SVG directly with proper headers
 */
router.get('/:name', (req, res) => {
  const rawName = req.params.name;
  const fileName = rawName.endsWith('.svg') ? rawName : `${rawName}.svg`;
  const filePath = path.join(config.symbolsDir, fileName);

  // Security check: ensure path is within symbols directory
  if (!filePath.startsWith(config.symbolsDir)) {
    return res.status(400).send('Invalid symbol path');
  }

  if (!fs.existsSync(filePath)) {
    // Fallback if not found: try fallback symbol
    const fallbackPath = path.join(config.symbolsDir, 'questionmark.circle.svg');
    if (fs.existsSync(fallbackPath)) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(fallbackPath);
    }
    return res.status(404).send('Symbol not found');
  }

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filePath);
});

export default router;
