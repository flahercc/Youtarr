import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import DownloadNew from '../DownloadNew';

const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Mock useConfig hook
const mockUseConfig = jest.fn();
jest.mock('../../../hooks/useConfig', () => ({
  useConfig: (token: string | null) => mockUseConfig(token),
}));

jest.mock('../ManualDownload/ManualDownload', () => ({
  __esModule: true,
  default: function MockManualDownload({ onStartDownload, token, defaultResolution }: any) {
    const React = require('react');
    return React.createElement('div', { 'data-testid': 'manual-download' },
      React.createElement('span', null, `Resolution: ${defaultResolution}`),
      React.createElement('button', {
        onClick: () => onStartDownload(['https://youtube.com/watch?v=test'], { resolution: '1080' }),
        'data-testid': 'trigger-manual-download'
      }, 'Start Manual Download'),
      React.createElement('button', {
        onClick: () => onStartDownload(['https://youtube.com/watch?v=test&list=123'], null),
        'data-testid': 'trigger-manual-with-ampersand'
      }, 'Download URL with ampersand'),
      React.createElement('button', {
        onClick: () => onStartDownload(
          ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
          null,
          { dQw4w9WgXcQ: 'UCuAXFkgsw1L7xaCfnd5JJOw' }
        ),
        'data-testid': 'trigger-manual-with-channel-map'
      }, 'Download With Channel Map')
    );
  }
}));

jest.mock('../../ErrorBoundary', () => ({
  __esModule: true,
  default: function MockErrorBoundary({ children }: any) {
    return children;
  }
}));

describe('DownloadNew', () => {
  const mockSetVideoUrls = jest.fn();
  const mockFetchRunningJobs = jest.fn();
  const mockDownloadInitiatedRef = { current: false };
  const mockToken = 'test-token';

  const defaultProps = {
    videoUrls: '',
    setVideoUrls: mockSetVideoUrls,
    token: mockToken,
    fetchRunningJobs: mockFetchRunningJobs,
    downloadInitiatedRef: mockDownloadInitiatedRef,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDownloadInitiatedRef.current = false;
    jest.useFakeTimers();

    // Default mock for useConfig hook
    mockUseConfig.mockReturnValue({
      config: {
        preferredResolution: '1080',
        channelFilesToDownload: 3,
      },
      initialConfig: null,
      isPlatformManaged: {
        plexUrl: false,
        authEnabled: true,
        useTmpForDownloads: false
      },
      deploymentEnvironment: {
        platform: null,
        isWsl: false,
      },
      loading: false,
      error: null,
      refetch: jest.fn(),
      setConfig: jest.fn(),
      setInitialConfig: jest.fn(),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('renders manual download without any tabs', () => {
    render(<DownloadNew {...defaultProps} />);

    expect(screen.getByText('Start Downloads')).toBeInTheDocument();
    expect(screen.getByTestId('manual-download')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  test('uses config from useConfig hook', async () => {
    mockUseConfig.mockReturnValue({
      config: {
        preferredResolution: '720',
        channelFilesToDownload: 10,
      },
      initialConfig: null,
      isPlatformManaged: {
        plexUrl: false,
        authEnabled: true,
        useTmpForDownloads: false
      },
      deploymentEnvironment: {
        platform: null,
        isWsl: false,
      },
      loading: false,
      error: null,
      refetch: jest.fn(),
      setConfig: jest.fn(),
      setInitialConfig: jest.fn(),
    });

    render(<DownloadNew {...defaultProps} />);

    await waitFor(() => {
      expect(mockUseConfig).toHaveBeenCalledWith(mockToken);
    });

    expect(screen.getByText('Resolution: 720')).toBeInTheDocument();
  });

  test('handles config errors by falling back to defaults', async () => {
    mockUseConfig.mockReturnValue({
      config: {
        preferredResolution: '1080',
        channelFilesToDownload: 3,
      },
      initialConfig: null,
      isPlatformManaged: {
        plexUrl: false,
        authEnabled: true,
        useTmpForDownloads: false
      },
      deploymentEnvironment: {
        platform: null,
        isWsl: false,
      },
      loading: false,
      error: new Error('Network error'),
      refetch: jest.fn(),
      setConfig: jest.fn(),
      setInitialConfig: jest.fn(),
    });

    render(<DownloadNew {...defaultProps} />);

    // Should still render with default values despite error
    expect(screen.getByText('Resolution: 1080')).toBeInTheDocument();
  });

  test('calls useConfig with null token when token is null', () => {
    render(<DownloadNew {...defaultProps} token={null} />);

    expect(mockUseConfig).toHaveBeenCalledWith(null);
  });

  test('handles manual download callback', async () => {
    const user = userEvent.setup({ delay: null });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValueOnce({}),
    });

    render(<DownloadNew {...defaultProps} />);

    const triggerButton = screen.getByTestId('trigger-manual-download');
    await user.click(triggerButton);

    expect(mockFetch).toHaveBeenCalledWith('/triggerspecificdownloads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-access-token': mockToken,
      },
      body: JSON.stringify({
        urls: ['https://youtube.com/watch?v=test'],
        overrideSettings: { resolution: '1080' }
      }),
    });

    expect(mockDownloadInitiatedRef.current).toBe(true);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/downloads/activity');
    });

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(mockFetchRunningJobs).toHaveBeenCalled();
  });

  test('strips URLs with ampersands in manual download', async () => {
    const user = userEvent.setup({ delay: null });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValueOnce({}),
    });

    render(<DownloadNew {...defaultProps} />);

    const triggerButton = screen.getByTestId('trigger-manual-with-ampersand');
    await user.click(triggerButton);

    expect(mockFetch).toHaveBeenCalledWith('/triggerspecificdownloads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-access-token': mockToken,
      },
      body: JSON.stringify({
        urls: ['https://youtube.com/watch?v=test']
      }),
    });
  });

  test('includes videoChannelMap in manual download request when provided', async () => {
    const user = userEvent.setup({ delay: null });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValueOnce({}),
    });

    render(<DownloadNew {...defaultProps} />);

    const triggerButton = screen.getByTestId('trigger-manual-with-channel-map');
    await user.click(triggerButton);

    expect(mockFetch).toHaveBeenCalledWith('/triggerspecificdownloads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-access-token': mockToken,
      },
      body: JSON.stringify({
        urls: ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
        videoChannelMap: { dQw4w9WgXcQ: 'UCuAXFkgsw1L7xaCfnd5JJOw' },
      }),
    });
  });

  test('updates default resolution from config', async () => {
    mockUseConfig.mockReturnValue({
      config: {
        preferredResolution: '4K',
        channelFilesToDownload: 15,
      },
      initialConfig: null,
      isPlatformManaged: {
        plexUrl: false,
        authEnabled: true,
        useTmpForDownloads: false
      },
      deploymentEnvironment: {
        platform: null,
        isWsl: false,
      },
      loading: false,
      error: null,
      refetch: jest.fn(),
      setConfig: jest.fn(),
      setInitialConfig: jest.fn(),
    });

    render(<DownloadNew {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Resolution: 4K')).toBeInTheDocument();
    });
  });
});
