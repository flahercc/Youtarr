/* eslint-env jest */
const express = require('express');
const request = require('supertest');

jest.mock('../../logger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

describe('New videos routes', () => {
  let app;
  let mockNewVideoQueueModule;
  let mockScheduledTaskManager;

  beforeEach(() => {
    jest.resetModules();
    mockNewVideoQueueModule = {
      getQueue: jest.fn().mockResolvedValue([]),
    };
    mockScheduledTaskManager = { runNow: jest.fn() };
    const createNewVideoRoutes = require('../newVideos');
    app = express();
    app.use(express.json());
    app.use(createNewVideoRoutes({
      verifyToken: (req, res, next) => next(),
      newVideoQueueModule: mockNewVideoQueueModule,
      scheduledTaskManager: mockScheduledTaskManager,
    }));
  });

  describe('GET /api/new-videos', () => {
    test('returns the queue and count', async () => {
      const videos = [{ youtube_id: 'a', title: 'Video A' }];
      mockNewVideoQueueModule.getQueue.mockResolvedValueOnce(videos);

      const res = await request(app).get('/api/new-videos');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ videos, count: 1 });
    });

    test('returns 500 when the module throws', async () => {
      mockNewVideoQueueModule.getQueue.mockRejectedValueOnce(new Error('boom'));
      const res = await request(app).get('/api/new-videos');
      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('POST /api/new-videos/scan', () => {
    const summary = { channelsScanned: 2, tabsScanned: 3, playlistsScanned: 1, newVideosFound: 5, errors: [] };

    // Mirrors runNow for a started run: the scan reports its summary when it
    // ends, and completion resolves after that.
    const startedRun = (result) => (key, { args }) => Promise.resolve({
      started: true,
      completion: new Promise((resolve) => setImmediate(() => {
        if (result) args.onSummary(result);
        resolve({ status: result ? 'success' : 'error', message: 'scan failed' });
      })),
    });

    test('returns the scan summary', async () => {
      mockScheduledTaskManager.runNow.mockImplementation(startedRun(summary));
      const res = await request(app).post('/api/new-videos/scan');
      expect([res.status, res.body]).toEqual([200, summary]);
    });

    test('starts a forced manual run of the scan task that ignores the switch and cooldown', async () => {
      mockScheduledTaskManager.runNow.mockImplementation(startedRun(summary));
      await request(app).post('/api/new-videos/scan');
      expect(mockScheduledTaskManager.runNow).toHaveBeenCalledWith('channelScanFrequency', expect.objectContaining({
        trigger: 'manual',
        args: expect.objectContaining({ force: true }),
        enforceEnabled: false,
        enforceCooldown: false,
      }));
    });

    test('returns 409 when a scan is already running', async () => {
      mockScheduledTaskManager.runNow.mockResolvedValue({ started: false, reason: 'running', message: 'Already running.' });
      const res = await request(app).post('/api/new-videos/scan');
      expect([res.status, res.body.error]).toEqual([409, 'A scan is already in progress']);
    });

    test('returns 503 when the scan task is not registered yet', async () => {
      mockScheduledTaskManager.runNow.mockResolvedValue({ started: false, reason: 'not-registered', message: 'Not ready.' });
      const res = await request(app).post('/api/new-videos/scan');
      expect(res.status).toBe(503);
    });

    test('returns 500 when the scan fails', async () => {
      mockScheduledTaskManager.runNow.mockImplementation(startedRun(null));
      const res = await request(app).post('/api/new-videos/scan');
      expect(res.status).toBe(500);
    });

    test('returns 500 when the scan cannot be started', async () => {
      mockScheduledTaskManager.runNow.mockRejectedValue(new Error('boom'));
      const res = await request(app).post('/api/new-videos/scan');
      expect(res.status).toBe(500);
    });
  });
});
