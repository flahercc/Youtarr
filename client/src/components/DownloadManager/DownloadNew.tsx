import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CardHeader,
  Grid,
} from '../ui';
import ManualDownload from './ManualDownload/ManualDownload';
import { DownloadSettings } from './ManualDownload/types';
import ErrorBoundary from '../ErrorBoundary';
import { useConfig } from '../../hooks/useConfig';

interface DownloadNewProps {
  videoUrls: string;
  setVideoUrls: React.Dispatch<React.SetStateAction<string>>;
  token: string | null;
  fetchRunningJobs: () => void;
  downloadInitiatedRef: React.MutableRefObject<boolean>;
}

const DownloadNew: React.FC<DownloadNewProps> = ({
  videoUrls,
  setVideoUrls,
  token,
  fetchRunningJobs,
  downloadInitiatedRef,
}) => {
  const navigate = useNavigate();

  // Use config hook to get default resolution
  const { config } = useConfig(token);
  const defaultResolution = config.preferredResolution || '1080';

  const handleManualDownload = useCallback(async (
    urls: string[],
    settings?: DownloadSettings | null,
    videoChannelMap?: Record<string, string>
  ) => {
    downloadInitiatedRef.current = true;
    const strippedUrls = urls.map((url) =>
      url.includes('&') ? url.substring(0, url.indexOf('&')) : url
    );

    const body: any = { urls: strippedUrls };
    // Add settings to the request body if provided
    if (settings) {
      body.overrideSettings = settings;
    }
    if (videoChannelMap && Object.keys(videoChannelMap).length > 0) {
      body.videoChannelMap = videoChannelMap;
    }

    await fetch('/triggerspecificdownloads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-access-token': token || '',
      },
      body: JSON.stringify(body),
    });

    setTimeout(fetchRunningJobs, 1000);
    navigate('/downloads/activity');
  }, [token, fetchRunningJobs, downloadInitiatedRef, navigate]);

  return (
    <Grid item xs={12} md={12}>
      <div>
        <CardHeader
          title='Start Downloads'
          align='center'
          className="px-0 pt-0"
          style={{ marginBottom: '-16px' }}
        />
        <ErrorBoundary
          fallbackMessage="An error occurred in the download manager. Please refresh the page and try again."
        >
          <ManualDownload
            onStartDownload={handleManualDownload}
            token={token}
            defaultResolution={defaultResolution}
          />
        </ErrorBoundary>
      </div>
    </Grid>
  );
};

export default DownloadNew;
