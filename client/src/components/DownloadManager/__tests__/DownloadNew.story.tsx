import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, userEvent, within, waitFor } from 'storybook/test';
import DownloadNew from '../DownloadNew';
import { http, HttpResponse } from 'msw';

const meta: Meta<typeof DownloadNew> = {
  title: 'Components/DownloadManager/DownloadNew',
  component: DownloadNew,
  parameters: {
    docs: {
      disable: true,
    },
    msw: {
      handlers: [
        http.get('/getconfig', () => {
          return HttpResponse.json({
            darkModeEnabled: false,
            preferredResolution: '1080',
            channelFilesToDownload: 3,
          });
        }),
        http.get('/api/channels/subfolders', () => {
          return HttpResponse.json(['Movies', 'Shows']);
        }),
        http.post('/triggerspecificdownloads', () => {
          return HttpResponse.json({ success: true, jobId: 'test-job-1' });
        }),
        http.post('/api/checkYoutubeVideoURL', async ({ request }) => {
          const body = (await request.json()) as { url?: string };
          const url = body.url || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
          const youtubeId = url.includes('video2') ? 'video2' : 'video1';
          return HttpResponse.json({
            isValidUrl: true,
            isAlreadyDownloaded: false,
            isMembersOnly: false,
            metadata: {
              youtubeId,
              url,
              channelName: 'Storybook Channel',
              videoTitle: youtubeId === 'video2' ? 'Second Story Video' : 'First Story Video',
              duration: 213,
              publishedAt: Date.now(),
              media_type: 'video',
            },
          });
        }),
      ],
    },
  },
  args: {
    videoUrls: '',
    setVideoUrls: fn(),
    token: 'test-token',
    fetchRunningJobs: fn(),
    downloadInitiatedRef: { current: false },
  },
};

export default meta;
type Story = StoryObj<typeof DownloadNew>;

/**
 * Default DownloadNew component
 * Tests the manual download form renders without any tabs
 */
export const Default: Story = {
  args: {
    videoUrls: '',
    setVideoUrls: fn(),
    token: 'test-token',
    fetchRunningJobs: fn(),
    downloadInitiatedRef: { current: false },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByPlaceholderText(/paste youtube video url here/i)).toBeInTheDocument();
    await expect(canvas.queryByRole('tab')).not.toBeInTheDocument();
  },
};

/**
 * Manual Download
 * Tests URL input interaction and download trigger
 */
export const ManualDownload: Story = {
  args: {
    videoUrls: '',
    setVideoUrls: fn(),
    token: 'test-token',
    fetchRunningJobs: fn(),
    downloadInitiatedRef: { current: false },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);

    const urlInput = await canvas.findByPlaceholderText(/paste youtube video url here/i);
    await userEvent.type(urlInput, 'https://www.youtube.com/watch?v=video1{enter}');

    await expect(await canvas.findByText(/first story video/i)).toBeInTheDocument();

    const downloadButton = await canvas.findByRole('button', { name: /download videos/i });
    await userEvent.click(downloadButton);

    await expect(await body.findByRole('dialog', { name: /download settings/i })).toBeInTheDocument();
    const startButton = await body.findByRole('button', { name: /start download/i });
    await userEvent.click(startButton);

    await waitFor(async () => {
      await expect(args.fetchRunningJobs).toHaveBeenCalled();
    }, { timeout: 2000 });
  },
};

/**
 * Settings Dialog Open
 * Tests opening and interacting with the download settings dialog
 */
export const SettingsDialogOpen: Story = {
  args: {
    videoUrls: '',
    setVideoUrls: fn(),
    token: 'test-token',
    fetchRunningJobs: fn(),
    downloadInitiatedRef: { current: false },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);

    const urlInput = await canvas.findByPlaceholderText(/paste youtube video url here/i);
    await userEvent.type(urlInput, 'https://www.youtube.com/watch?v=video1{enter}');
    await expect(await canvas.findByText(/first story video/i)).toBeInTheDocument();

    const downloadButton = await canvas.findByRole('button', { name: /download videos/i });
    await userEvent.click(downloadButton);

    await expect(await body.findByRole('dialog', { name: /download settings/i })).toBeInTheDocument();
    const customToggle = await body.findByLabelText(/use custom settings/i);
    await userEvent.click(customToggle);

    const resolutionSelect = await body.findByLabelText(/maximum resolution/i);
    await userEvent.click(resolutionSelect);
    const resolutionOption = await body.findByRole('option', { name: /720p/i });
    await userEvent.click(resolutionOption);

    const startButton = await body.findByRole('button', { name: /start download/i });
    await userEvent.click(startButton);

    await waitFor(async () => {
      await expect(args.fetchRunningJobs).toHaveBeenCalled();
    }, { timeout: 2000 });
  },
};

/**
 * With Pre-filled URLs
 * Tests component with video URLs already populated
 */
export const WithUrls: Story = {
  args: {
    videoUrls: 'https://www.youtube.com/watch?v=video1\nhttps://www.youtube.com/watch?v=video2',
    setVideoUrls: fn(),
    token: 'test-token',
    fetchRunningJobs: fn(),
    downloadInitiatedRef: { current: false },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);

    const urlInput = await canvas.findByPlaceholderText(/paste youtube video url here/i);
    await userEvent.type(urlInput, 'https://www.youtube.com/watch?v=video1{enter}');
    await expect(await canvas.findByText(/first story video/i)).toBeInTheDocument();

    await userEvent.type(urlInput, 'https://www.youtube.com/watch?v=video2{enter}');
    await expect(await canvas.findByText(/second story video/i)).toBeInTheDocument();

    const downloadButton = await canvas.findByRole('button', { name: /download videos/i });
    await userEvent.click(downloadButton);
    const startButton = await body.findByRole('button', { name: /start download/i });
    await userEvent.click(startButton);

    await waitFor(async () => {
      await expect(args.fetchRunningJobs).toHaveBeenCalled();
    }, { timeout: 2000 });
  },
};
