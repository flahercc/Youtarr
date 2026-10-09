import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import VideoActivityProvider, { useVideoActivity } from '../VideoActivityProvider';
import WebSocketContext from '../../contexts/WebSocketContext';

jest.mock('axios');
const get = axios.get as jest.Mock;
const videoId = 'aaaaaaaaaaa';
const snapshot = (revision: number, state?: 'queued' | 'downloading', instanceId = 'server') => ({
  instanceId, revision, videos: state ? { [videoId]: { jobId: 'job', state } } : {},
});

describe('shared video activity', () => {
  let subscriptions: Array<{ filter: (message: { destination: string; type: string }) => boolean; callback: () => void }>;
  const subscribe = jest.fn();
  const unsubscribe = jest.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <WebSocketContext.Provider value={{ socket: null, subscribe, unsubscribe }}>
      <VideoActivityProvider token="token">{children}</VideoActivityProvider>
    </WebSocketContext.Provider>
  );
  const emit = (type: string) => act(() => {
    subscriptions.forEach(sub => {
      if (sub.filter({ destination: 'broadcast', type })) sub.callback();
    });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    subscriptions = [];
    subscribe.mockImplementation((filter, callback) => { subscriptions.push({ filter, callback }); });
  });

  it('seeds a page opened mid-download and clears finished videos', async () => {
    get.mockResolvedValueOnce({ data: snapshot(1, 'downloading') });
    const { result } = renderHook(() => useVideoActivity(), { wrapper });
    await waitFor(() => expect(result.current.snapshot.videos[videoId]?.state).toBe('downloading'));
    get.mockResolvedValueOnce({ data: snapshot(2) });
    emit('videoActivityUpdated');
    await waitFor(() => expect(result.current.snapshot.videos[videoId]).toBeUndefined());
  });

  it('replaces activity after reconnecting to a restarted server', async () => {
    get.mockResolvedValueOnce({ data: snapshot(20, 'queued') });
    const { result } = renderHook(() => useVideoActivity(), { wrapper });
    await waitFor(() => expect(result.current.snapshot.revision).toBe(20));
    get.mockResolvedValueOnce({ data: snapshot(0, undefined, 'restarted') });
    emit('connectionRestored');
    await waitFor(() => expect(result.current.snapshot.instanceId).toBe('restarted'));
    expect(result.current.snapshot.videos).toEqual({});
  });

  it('re-probes instead of applying a snapshot overtaken by an event', async () => {
    let resolveFirst!: (value: unknown) => void;
    get.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
    const { result } = renderHook(() => useVideoActivity(), { wrapper });
    get.mockResolvedValueOnce({ data: snapshot(2, 'downloading') });
    emit('videoActivityUpdated');
    await act(async () => { resolveFirst({ data: snapshot(1, 'queued') }); });
    await waitFor(() => expect(result.current.snapshot.revision).toBe(2));
    expect(result.current.snapshot.videos[videoId]?.state).toBe('downloading');
  });

  it('does not query activity before authentication', () => {
    renderHook(() => useVideoActivity(), {
      wrapper: ({ children }) => <VideoActivityProvider token={null}>{children}</VideoActivityProvider>,
    });
    expect(get).not.toHaveBeenCalled();
  });
});
