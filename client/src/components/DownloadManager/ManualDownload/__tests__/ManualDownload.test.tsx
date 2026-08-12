import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import axios from 'axios';
import ManualDownload from '../ManualDownload';
import { ValidationResponse, VideoInfo } from '../types';

jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn(),
  create: jest.fn(() => ({
    post: jest.fn(),
    get: jest.fn()
  })),
  isAxiosError: (e: unknown) => Boolean(e && (e as { isAxiosError?: boolean }).isAxiosError),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('../UrlInput', () => {
  return function MockUrlInput({ onValidate, isValidating, disabled }: any) {
    return (
      <div data-testid="url-input">
        <button
          onClick={() => onValidate('https://youtube.com/watch?v=test123')}
          disabled={isValidating || disabled}
          data-testid="validate-button"
        >
          Validate
        </button>
      </div>
    );
  };
});

jest.mock('../BulkImportDialog', () => {
  return function MockBulkImportDialog({ open, onClose, onImport }: any) {
    if (!open) return null;
    return (
      <div data-testid="bulk-import-dialog">
        <button
          onClick={() =>
            onImport([
              {
                youtubeId: 'bulk1',
                url: 'https://www.youtube.com/watch?v=bulk1aaaaaa',
                channelName: '',
                videoTitle: '',
                duration: 0,
                publishedAt: 0,
                isAlreadyDownloaded: false,
                isMembersOnly: false,
                isBulkImport: true,
              },
            ])
          }
          data-testid="bulk-import-confirm"
        >
          Add to Queue
        </button>
        <button onClick={onClose} data-testid="bulk-import-cancel">
          Cancel
        </button>
      </div>
    );
  };
});

jest.mock('../DownloadSettingsDialog', () => {
  return function MockDownloadSettingsDialog({ open, onClose, onConfirm, videoCount }: any) {
    if (!open) return null;
    return (
      <div data-testid="download-settings-dialog">
        <span data-testid="dialog-video-count">{videoCount}</span>
        <button onClick={() => onConfirm(null)} data-testid="confirm-download">
          Start Download
        </button>
        <button onClick={onClose} data-testid="cancel-download">
          Cancel
        </button>
      </div>
    );
  };
});

// NewVideosQueue's own behavior (merging, selection, per-source routing) is
// covered by its own test suite. Here we only need to verify ManualDownload
// wires manualVideos/isDownloadingManual/onRemoveManual/onDownloadManualSelected
// correctly, so the mock exposes those as simple test hooks.
jest.mock('../NewVideosQueue/NewVideosQueue', () => {
  return function MockNewVideosQueue({ manualVideos, isDownloadingManual, onRemoveManual, onDownloadManualSelected }: any) {
    return (
      <div data-testid="new-videos-queue">
        <span data-testid="is-downloading-manual">{String(isDownloadingManual)}</span>
        {manualVideos.map((v: VideoInfo) => (
          <div key={v.youtubeId} data-testid={`manual-video-${v.youtubeId}`}>
            {v.videoTitle}
          </div>
        ))}
        <button
          onClick={() => onDownloadManualSelected(manualVideos)}
          data-testid="trigger-download-selected"
        >
          Download Selected
        </button>
        <button
          onClick={() => onRemoveManual(manualVideos.map((v: VideoInfo) => v.youtubeId))}
          data-testid="trigger-remove-selected"
        >
          Remove Selected
        </button>
      </div>
    );
  };
});

describe('ManualDownload', () => {
  const mockOnStartDownload = jest.fn();
  const mockToken = 'test-token';

  const mockValidationResponse: ValidationResponse = {
    isValidUrl: true,
    isAlreadyDownloaded: false,
    isMembersOnly: false,
    metadata: {
      youtubeId: 'test123',
      url: 'https://youtube.com/watch?v=test123',
      channelName: 'Test Channel',
      videoTitle: 'Test Video',
      duration: 300,
      publishedAt: 1234567890,
      media_type: 'video'
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.post.mockImplementation((url: string) => {
      if (url === '/api/bulkEnrichVideos') {
        return Promise.resolve({ data: { enriched: {} } });
      }
      return Promise.reject(new Error(`Unexpected POST to ${url}`));
    });
  });

  test('renders the Add Videos panel and the queue', () => {
    render(<ManualDownload onStartDownload={mockOnStartDownload} token={mockToken} />);

    expect(screen.getByText('Add Videos to Download')).toBeInTheDocument();
    expect(screen.getByTestId('url-input')).toBeInTheDocument();
    expect(screen.getByTestId('new-videos-queue')).toBeInTheDocument();
  });

  test('validates and adds a valid video, passing it through to the queue', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: mockValidationResponse });

    render(<ManualDownload onStartDownload={mockOnStartDownload} token={mockToken} />);

    fireEvent.click(screen.getByTestId('validate-button'));

    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenCalledWith(
        '/api/checkYoutubeVideoURL',
        { url: 'https://youtube.com/watch?v=test123' },
        { headers: { 'x-access-token': mockToken } }
      );
    });

    expect(await screen.findByTestId('manual-video-test123')).toHaveTextContent('Test Video');
    expect(screen.getByText('Video added to download list.')).toBeInTheDocument();
  });

  test('shows error for invalid YouTube URL', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { isValidUrl: false } });

    render(<ManualDownload onStartDownload={mockOnStartDownload} token={mockToken} />);
    fireEvent.click(screen.getByTestId('validate-button'));

    await waitFor(() => {
      expect(screen.getByText('Invalid YouTube URL. Please check the URL and try again.')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('manual-video-test123')).not.toBeInTheDocument();
  });

  test('shows error for members-only videos', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { isValidUrl: true, isMembersOnly: true } });

    render(<ManualDownload onStartDownload={mockOnStartDownload} token={mockToken} />);
    fireEvent.click(screen.getByTestId('validate-button'));

    await waitFor(() => {
      expect(screen.getByText('This video is members-only and cannot be downloaded.')).toBeInTheDocument();
    });
  });

  test('prevents duplicate videos in the queue', async () => {
    mockedAxios.post.mockResolvedValue({ data: mockValidationResponse });

    render(<ManualDownload onStartDownload={mockOnStartDownload} token={mockToken} />);
    const validateButton = screen.getByTestId('validate-button');

    fireEvent.click(validateButton);
    await screen.findByTestId('manual-video-test123');

    fireEvent.click(validateButton);
    await waitFor(() => {
      expect(screen.getByText('This video is already in your download list.')).toBeInTheDocument();
    });
    expect(screen.getAllByTestId('manual-video-test123')).toHaveLength(1);
  });

  test('handles API errors gracefully', async () => {
    mockedAxios.post.mockRejectedValueOnce({ isAxiosError: true, response: { status: 429 } });

    render(<ManualDownload onStartDownload={mockOnStartDownload} token={mockToken} />);
    fireEvent.click(screen.getByTestId('validate-button'));

    await waitFor(() => {
      expect(screen.getByText('Too many requests. Please wait a moment and try again.')).toBeInTheDocument();
    });
  });

  test('handles custom error messages from API', async () => {
    mockedAxios.post.mockRejectedValueOnce({ isAxiosError: true, response: { data: { error: 'Custom error message' } } });

    render(<ManualDownload onStartDownload={mockOnStartDownload} token={mockToken} />);
    fireEvent.click(screen.getByTestId('validate-button'));

    await waitFor(() => {
      expect(screen.getByText('Custom error message')).toBeInTheDocument();
    });
  });

  test('handles generic API errors', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));

    render(<ManualDownload onStartDownload={mockOnStartDownload} token={mockToken} />);
    fireEvent.click(screen.getByTestId('validate-button'));

    await waitFor(() => {
      expect(screen.getByText('Failed to validate URL. Please try again.')).toBeInTheDocument();
    });
  });

  test('removes videos when the queue asks to remove them', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: mockValidationResponse });

    render(<ManualDownload onStartDownload={mockOnStartDownload} token={mockToken} />);
    fireEvent.click(screen.getByTestId('validate-button'));
    await screen.findByTestId('manual-video-test123');

    fireEvent.click(screen.getByTestId('trigger-remove-selected'));

    await waitFor(() => {
      expect(screen.queryByTestId('manual-video-test123')).not.toBeInTheDocument();
    });
  });

  test('opens the settings dialog scoped to the videos the queue passes, and downloads them', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: mockValidationResponse });
    mockOnStartDownload.mockResolvedValueOnce(undefined);

    render(<ManualDownload onStartDownload={mockOnStartDownload} token={mockToken} />);
    fireEvent.click(screen.getByTestId('validate-button'));
    await screen.findByTestId('manual-video-test123');

    fireEvent.click(screen.getByTestId('trigger-download-selected'));

    expect(await screen.findByTestId('download-settings-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('dialog-video-count')).toHaveTextContent('1');

    fireEvent.click(screen.getByTestId('confirm-download'));

    await waitFor(() => {
      expect(mockOnStartDownload).toHaveBeenCalledWith(
        ['https://youtube.com/watch?v=test123'],
        null,
        undefined
      );
    });
    expect(await screen.findByText('Started downloading 1 video.')).toBeInTheDocument();
    // Downloaded video is cleared from the pending list afterward.
    expect(screen.queryByTestId('manual-video-test123')).not.toBeInTheDocument();
  });

  test('passes a videoChannelMap built from the videos being downloaded', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        ...mockValidationResponse,
        metadata: {
          ...mockValidationResponse.metadata,
          youtubeId: 'dQw4w9WgXcQ',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
        },
      },
    });

    render(<ManualDownload onStartDownload={mockOnStartDownload} token={mockToken} />);
    fireEvent.click(screen.getByTestId('validate-button'));
    await screen.findByTestId('manual-video-dQw4w9WgXcQ');

    fireEvent.click(screen.getByTestId('trigger-download-selected'));
    await screen.findByTestId('download-settings-dialog');
    fireEvent.click(screen.getByTestId('confirm-download'));

    await waitFor(() => {
      expect(mockOnStartDownload).toHaveBeenCalledWith(
        ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
        null,
        { dQw4w9WgXcQ: 'UCuAXFkgsw1L7xaCfnd5JJOw' }
      );
    });
  });

  test('handles download error', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: mockValidationResponse });
    mockOnStartDownload.mockRejectedValueOnce(new Error('Download failed'));

    render(<ManualDownload onStartDownload={mockOnStartDownload} token={mockToken} />);
    fireEvent.click(screen.getByTestId('validate-button'));
    await screen.findByTestId('manual-video-test123');

    fireEvent.click(screen.getByTestId('trigger-download-selected'));
    await screen.findByTestId('download-settings-dialog');
    fireEvent.click(screen.getByTestId('confirm-download'));

    await waitFor(() => {
      expect(screen.getByText('Failed to start download. Please try again.')).toBeInTheDocument();
    });
  });

  test('marks the queue as downloading while a download is in flight', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: mockValidationResponse });
    mockOnStartDownload.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 50)));

    render(<ManualDownload onStartDownload={mockOnStartDownload} token={mockToken} />);
    fireEvent.click(screen.getByTestId('validate-button'));
    await screen.findByTestId('manual-video-test123');

    expect(screen.getByTestId('is-downloading-manual')).toHaveTextContent('false');

    fireEvent.click(screen.getByTestId('trigger-download-selected'));
    await screen.findByTestId('download-settings-dialog');
    fireEvent.click(screen.getByTestId('confirm-download'));

    await waitFor(() => {
      expect(screen.getByTestId('is-downloading-manual')).toHaveTextContent('true');
    });

    await waitFor(() => {
      expect(screen.getByTestId('is-downloading-manual')).toHaveTextContent('false');
    });
  });

  test('handles null token', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: mockValidationResponse });

    render(<ManualDownload onStartDownload={mockOnStartDownload} token={null} />);
    fireEvent.click(screen.getByTestId('validate-button'));

    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenCalledWith(
        '/api/checkYoutubeVideoURL',
        { url: 'https://youtube.com/watch?v=test123' },
        { headers: { 'x-access-token': '' } }
      );
    });
  });

  test('renders the Bulk Import button', () => {
    render(<ManualDownload onStartDownload={mockOnStartDownload} token={mockToken} />);

    expect(screen.getByRole('button', { name: /bulk import/i })).toBeInTheDocument();
  });

  test('opens bulk import dialog when the button is clicked', () => {
    render(<ManualDownload onStartDownload={mockOnStartDownload} token={mockToken} />);

    fireEvent.click(screen.getByRole('button', { name: /bulk import/i }));

    expect(screen.getByTestId('bulk-import-dialog')).toBeInTheDocument();
  });

  test('adds bulk-imported videos to the queue and closes the dialog', async () => {
    render(<ManualDownload onStartDownload={mockOnStartDownload} token={mockToken} />);

    fireEvent.click(screen.getByRole('button', { name: /bulk import/i }));
    fireEvent.click(screen.getByTestId('bulk-import-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('manual-video-bulk1')).toBeInTheDocument();
    });
    expect(screen.getByText('Added 1 URL to download queue.')).toBeInTheDocument();
    expect(screen.queryByTestId('bulk-import-dialog')).not.toBeInTheDocument();
  });

  test('downloads bulk-imported videos', async () => {
    mockOnStartDownload.mockResolvedValueOnce(undefined);

    render(<ManualDownload onStartDownload={mockOnStartDownload} token={mockToken} />);

    fireEvent.click(screen.getByRole('button', { name: /bulk import/i }));
    fireEvent.click(screen.getByTestId('bulk-import-confirm'));
    await screen.findByTestId('manual-video-bulk1');

    fireEvent.click(screen.getByTestId('trigger-download-selected'));
    await screen.findByTestId('download-settings-dialog');
    fireEvent.click(screen.getByTestId('confirm-download'));

    await waitFor(() => {
      expect(mockOnStartDownload).toHaveBeenCalledWith(
        ['https://www.youtube.com/watch?v=bulk1aaaaaa'],
        null,
        undefined
      );
    });
  });
});
