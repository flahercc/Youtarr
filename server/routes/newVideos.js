const express = require('express');
const logger = require('../logger');

/**
 * New-videos discovery queue routes (session-auth only).
 * @param {Object} deps
 * @param {Function} deps.verifyToken
 * @param {Object} deps.newVideoQueueModule
 * @param {Object} deps.newVideoScanScheduler
 * @returns {express.Router}
 */
function createNewVideoRoutes({ verifyToken, newVideoQueueModule, newVideoScanScheduler }) {
  const router = express.Router();

  /**
   * @swagger
   * /api/new-videos:
   *   get:
   *     summary: List the new-videos review queue
   *     description: Videos discovered across all enabled/subscribed channels and playlists that are not yet downloaded or ignored, newest-discovered first.
   *     tags: [NewVideos]
   *     responses:
   *       200:
   *         description: Queue of pending videos
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 videos:
   *                   type: array
   *                   items:
   *                     type: object
   *                 count:
   *                   type: integer
   *       500:
   *         description: Failed to load the new-videos queue
   */
  router.get('/api/new-videos', verifyToken, async (req, res) => {
    try {
      const videos = await newVideoQueueModule.getQueue();
      res.json({ videos, count: videos.length });
    } catch (error) {
      logger.error({ err: error }, 'Failed to load new-videos queue');
      res.status(500).json({ error: 'Failed to load new-videos queue' });
    }
  });

  /**
   * @swagger
   * /api/new-videos/scan:
   *   post:
   *     summary: Scan all enabled channels and playlists for new videos
   *     description: Manually trigger the same scan the scheduled new-videos-scan task runs, refreshing every enabled channel's auto-download-enabled tabs and every enabled playlist.
   *     tags: [NewVideos]
   *     responses:
   *       200:
   *         description: Scan complete
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 channelsScanned:
   *                   type: integer
   *                 tabsScanned:
   *                   type: integer
   *                 playlistsScanned:
   *                   type: integer
   *                 newVideosFound:
   *                   type: integer
   *                 errors:
   *                   type: array
   *                   items:
   *                     type: object
   *       409:
   *         description: A scan is already in progress
   *       500:
   *         description: Scan failed
   */
  router.post('/api/new-videos/scan', verifyToken, async (req, res) => {
    try {
      const summary = await newVideoScanScheduler.scanAll(true);
      res.json(summary);
    } catch (error) {
      if (error.message === 'SCAN_IN_PROGRESS') {
        return res.status(409).json({ error: 'A scan is already in progress' });
      }
      logger.error({ err: error }, 'Failed to run new-videos scan');
      res.status(500).json({ error: 'Failed to run new-videos scan' });
    }
  });

  return router;
}

module.exports = createNewVideoRoutes;
