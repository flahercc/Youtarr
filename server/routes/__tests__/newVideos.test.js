/* eslint-env jest */
const express = require('express');
const request = require('supertest');

jest.mock('../../logger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

describe('New videos routes', () => {
  let app;
  let mockNewVideoQueueModule;
  let mockNewVideoScanScheduler;

  beforeEach(() => {
    jest.resetModules();
    mockNewVideoQueueModule = {
      getQueue: jest.fn().mockResolvedValue([]),
    };
    mockNewVideoScanScheduler = {
      scanAll: jest.fn().mockResolvedValue({
        channelsScanned: 0, tabsScanned: 0, playlistsScanned: 0, newVideosFound: 0, errors: [],
      }),
    };
    const createNewVideoRoutes = require('../newVideos');
    app = express();
    app.use(express.json());
    app.use(createNewVideoRoutes({
      verifyToken: (req, res, next) => next(),
      newVideoQueueModule: mockNewVideoQueueModule,
      newVideoScanScheduler: mockNewVideoScanScheduler,
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
    test('runs the scan and returns the summary', async () => {
      const summary = { channelsScanned: 2, tabsScanned: 3, playlistsScanned: 1, newVideosFound: 5, errors: [] };
      mockNewVideoScanScheduler.scanAll.mockResolvedValueOnce(summary);

      const res = await request(app).post('/api/new-videos/scan');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(summary);
      expect(mockNewVideoScanScheduler.scanAll).toHaveBeenCalledWith(true);
    });

    test('returns 409 when a scan is already in progress', async () => {
      mockNewVideoScanScheduler.scanAll.mockRejectedValueOnce(new Error('SCAN_IN_PROGRESS'));
      const res = await request(app).post('/api/new-videos/scan');
      expect(res.status).toBe(409);
      expect(res.body.error).toBeDefined();
    });

    test('returns 500 for unexpected failures', async () => {
      mockNewVideoScanScheduler.scanAll.mockRejectedValueOnce(new Error('boom'));
      const res = await request(app).post('/api/new-videos/scan');
      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });
  });
});
